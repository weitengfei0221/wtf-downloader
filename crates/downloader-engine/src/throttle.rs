// Speed limiting (ARCHITECTURE section 1.6). GCRA limiters behind an
// atomically swappable Arc so rate changes are picked up on the very next
// chunk acquisition (AC-12 convergence).

#[cfg(test)]
mod tests;

use crate::protocol::TaskId;
use arc_swap::ArcSwapOption;
use governor::clock::DefaultClock;
use governor::state::{InMemoryState, NotKeyed};
use governor::{Quota, RateLimiter};
use std::collections::HashMap;
use std::num::NonZeroU32;
use std::sync::{Arc, Mutex};
use std::time::Duration;

type Limiter = RateLimiter<NotKeyed, InMemoryState, DefaultClock>;

/// Burst capacity: clamp(bps / 4, 256KB, 1MB). The 256KB floor lets a whole
/// chunk be taken in one shot; the 1MB cap bounds convergence after a rate
/// change to about one second (AC-12 allows two).
const BURST_MIN: u32 = 256 * 1024;
const BURST_MAX: u32 = 1024 * 1024;

/// Largest replenish rate we model (period granularity floor of 1ns).
const MAX_BPS: u64 = 1_000_000_000;

pub struct ThrottleRegistry {
    global: ArcSwapOption<Limiter>,
    per_task: Mutex<HashMap<TaskId, Arc<Limiter>>>,
}

fn build_limiter(bps: u64) -> Arc<Limiter> {
    let bps = bps.clamp(1, MAX_BPS);
    let burst = (bps / 4).clamp(BURST_MIN as u64, BURST_MAX as u64) as u32;
    // Replenish one token per (1s / bps); burst capacity independent.
    let period_ns = (1_000_000_000u64 / bps).max(1);
    let quota = Quota::with_period(Duration::from_nanos(period_ns))
        .expect("period is nonzero by construction")
        .allow_burst(NonZeroU32::new(burst).expect("burst is clamped >= 256KB"));
    Arc::new(RateLimiter::direct(quota))
}

impl ThrottleRegistry {
    pub fn new() -> Self {
        Self { global: ArcSwapOption::new(None), per_task: Mutex::new(HashMap::new()) }
    }

    /// Hot-adjust the global limit by wholesale atomic replacement. `None`
    /// removes the limiter (unlimited).
    pub fn set_global(&self, bps: Option<u64>) {
        match bps {
            Some(bps) if bps > 0 => self.global.store(Some(build_limiter(bps))),
            _ => self.global.store(None),
        }
    }

    pub fn set_task(&self, id: &TaskId, bps: Option<u64>) {
        let mut map = self.per_task.lock().unwrap();
        match bps {
            Some(bps) if bps > 0 => {
                map.insert(id.clone(), build_limiter(bps));
            }
            _ => {
                map.remove(id);
            }
        }
    }

    pub fn clear_task(&self, id: &TaskId) {
        self.per_task.lock().unwrap().remove(id);
    }

    /// Called once per CHUNK_BYTES by segment workers: acquire from the
    /// global limiter and the task-level limiter in turn. A chunk is bound
    /// by both layers (effective rate = the slower one); either layer being
    /// absent removes its constraint.
    pub async fn acquire(&self, task_id: &str, bytes: u32) {
        let n = match NonZeroU32::new(bytes) {
            Some(n) => n,
            None => return,
        };
        // Load Arcs out of the locks first: never hold a lock across await.
        let global = self.global.load_full();
        let task = self.per_task.lock().unwrap().get(task_id).cloned();
        if let Some(limiter) = global {
            // capacity floor is 256KB >= chunk size, so capacity is always
            // sufficient; an Err would be a programming error, not transient.
            let _ = limiter.until_n_ready(n).await;
        }
        if let Some(limiter) = task {
            let _ = limiter.until_n_ready(n).await;
        }
    }
}

impl Default for ThrottleRegistry {
    fn default() -> Self {
        Self::new()
    }
}

/// Exponential backoff for segment retries: 500ms << attempt, capped at 8s.
pub fn backoff_delay(attempt: u32) -> Duration {
    let shift = attempt.min(5);
    let ms = (crate::consts::RETRY_BACKOFF_BASE_MS << shift).min(crate::consts::RETRY_BACKOFF_CAP_MS);
    Duration::from_millis(ms)
}
