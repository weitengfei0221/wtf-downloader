use downloader_engine::protocol::EngineError;

#[cfg(test)]
mod tests;

/// Error shape crossing the IPC boundary. `code` follows the locked enum
/// in ARCHITECTURE.md section 3.2.
#[derive(Debug, thiserror::Error)]
#[error("{code}: {message}")]
pub struct AppError {
    pub code: String,
    pub message: String,
}

impl serde::Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut st = s.serialize_struct("AppError", 2)?;
        st.serialize_field("code", &self.code)?;
        st.serialize_field("message", &self.message)?;
        st.end()
    }
}

impl AppError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self { code: code.to_string(), message: message.into() }
    }
}

impl From<EngineError> for AppError {
    fn from(e: EngineError) -> Self {
        let (code, message) = match &e {
            EngineError::InvalidUrl(m) => ("invalid_url".to_string(), m.clone()),
            EngineError::InvalidArgument(m) => ("invalid_argument".to_string(), m.clone()),
            EngineError::TaskNotFound(m) => ("task_not_found".to_string(), m.clone()),
            EngineError::ProbeFailed(m) => ("probe_failed".to_string(), m.clone()),
            EngineError::HttpStatus(status) => {
                (format!("http_status:{}", status), format!("HTTP {}", status))
            }
            EngineError::ResumeConflict(m) => ("resume_conflict".to_string(), m.clone()),
            EngineError::Io(m) => ("io_error".to_string(), m.clone()),
            EngineError::Db(m) => ("db_error".to_string(), m.clone()),
            EngineError::Engine(m) => ("engine_error".to_string(), m.clone()),
        };
        AppError { code, message }
    }
}

pub type CmdResult<T> = Result<T, AppError>;
