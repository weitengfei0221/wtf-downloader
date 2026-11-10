// Engine-wide constants. Values are the contract locked in
// ARCHITECTURE.md section 1.3; do not change without a Spec revision.

/// Minimum segment size; small files reduce their segment count against this.
pub const MIN_SEGMENT_BYTES: u64 = 8 * 1024 * 1024;

/// Task-level concurrency slots (global gate, no second-level semaphore).
pub const MAX_CONCURRENT_TASKS: usize = 3;

/// Chunk granularity for streaming reads and throttle token acquisition.
pub const CHUNK_BYTES: usize = 256 * 1024;

/// Default retries per segment (AC-06).
pub const SEGMENT_RETRIES: u32 = 3;

/// Exponential backoff base: 500ms, 1s, 2s, capped at 8s.
pub const RETRY_BACKOFF_BASE_MS: u64 = 500;
pub const RETRY_BACKOFF_CAP_MS: u64 = 8_000;

/// Minimum remaining size for splitting a failing segment.
pub const SPLIT_THRESHOLD_BYTES: u64 = 8 * 1024 * 1024;

/// Task-level retry budget guarding against split-induced infinite retries.
pub const TASK_RETRY_BUDGET: u32 = 6;

/// Redirect follow limit (Spec section 10).
pub const REDIRECT_LIMIT: usize = 10;

/// Progress snapshot persistence period (L3, ARCHITECTURE section 1.8).
pub const SNAPSHOT_INTERVAL_MS: u64 = 1000;

/// Progress frame production period (4Hz, Rust producer side).
pub const PROGRESS_INTERVAL_MS: u64 = 250;

/// Bounded progress channel capacity; full queue drops frames, never blocks.
pub const PROGRESS_CHANNEL_CAPACITY: usize = 64;

/// Probe timeout for the add-task dialog (AC-01, 2 seconds).
pub const PROBE_TIMEOUT_MS: u64 = 2_000;

/// Default segments when the user has not configured any.
pub const DEFAULT_SEGMENTS: u8 = 8;

/// Sentinel end byte for streams of unknown length (fits SQLite INTEGER).
pub const UNKNOWN_END_BYTE: u64 = i64::MAX as u64;
