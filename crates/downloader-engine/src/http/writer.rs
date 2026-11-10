// Disk writer: single .part file with offset writes (ADR-006).
// Write-ordering invariant (the one engine-wide iron rule):
//   disk write first -> then in-memory counters -> periodic DB snapshot.
// Crash recovery therefore always re-downloads a window instead of ever
// stitching mismatched data.

#[cfg(test)]
mod tests;

use crate::protocol::EngineError;
use std::fs::{File, OpenOptions};
use std::io::{Seek, SeekFrom, Write};
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Debug)]
pub struct PartWriter {
    /// {dir}/{filename}.part
    path: PathBuf,
    file: Mutex<File>,
    /// True when set_len preallocation succeeded (NTFS sparse).
    pub preallocated: bool,
}

impl PartWriter {
    /// Open or create the .part file. When the total size is known, try to
    /// preallocate with set_len (near-zero cost on NTFS); on failure degrade
    /// silently to on-demand extension (FAT32/exFAT zero-fill avoidance).
    pub fn open(path: PathBuf, total: Option<u64>) -> Result<Self, EngineError> {
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent)?;
            }
        }
        let file = OpenOptions::new().write(true).create(true).read(true).open(&path)?;
        let mut preallocated = false;
        if let Some(total) = total {
            preallocated = file.set_len(total).is_ok();
        }
        Ok(Self { path, file: Mutex::new(file), preallocated })
    }

    /// Seek to `offset` and write the buffer. Each call is one syscall:
    /// this IS the disk write step of the ordering invariant.
    pub fn write_at(&self, offset: u64, buf: &[u8]) -> Result<(), EngineError> {
        let mut file = self.file.lock().unwrap();
        file.seek(SeekFrom::Start(offset))?;
        file.write_all(buf)?;
        Ok(())
    }

    /// Completion path: sync, verify length (AC-07), rename to the final
    /// name. Fails when the final name already exists (race protection);
    /// the caller must mark the task failed in that case.
    pub fn finish(&self, expected_total: Option<u64>) -> Result<PathBuf, EngineError> {
        {
            let file = self.file.lock().unwrap();
            file.sync_all()?;
            let len = file.metadata()?.len();
            if let Some(expected) = expected_total {
                if len != expected {
                    return Err(EngineError::Io(format!(
                        "文件大小校验失败：实际 {} 字节，期望 {} 字节",
                        len, expected
                    )));
                }
            }
        }
        let name = self.path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let final_name = name.strip_suffix(".part").unwrap_or(&name).to_string();
        let final_path = self.path.with_file_name(final_name);
        if final_path.exists() {
            return Err(EngineError::Io(format!(
                "目标文件已存在，无法收名：{}",
                final_path.display()
            )));
        }
        std::fs::rename(&self.path, &final_path)?;
        Ok(final_path)
    }

    pub fn path(&self) -> &std::path::Path {
        &self.path
    }
}
