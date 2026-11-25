#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::{
    fs::OpenOptions,
    io::Write,
    net::TcpListener,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::Duration,
};
use tauri::Manager;

#[cfg(windows)]
mod lifecycle;

#[derive(Clone, Serialize)]
struct Connection {
    url: String,
    token: String,
}
struct BackendProcess {
    connection: Connection,
    child: Child,
    log_path: PathBuf,
    #[cfg(windows)]
    _job: lifecycle::ProcessTreeJob,
}

#[derive(Default)]
struct BackendState {
    process: Option<BackendProcess>,
    error: Option<String>,
    stopping: bool,
}

type Backend = Mutex<BackendState>;

impl BackendState {
    fn check_exit(&mut self) -> Result<(), String> {
        if let Some(process) = &mut self.process {
            if let Some(status) = process
                .child
                .try_wait()
                .map_err(|error| error.to_string())?
            {
                self.error = Some(format!(
                    "Backend đã dừng ({status}). Nhật ký: {}",
                    process.log_path.display()
                ));
                self.process = None;
            }
        }
        Ok(())
    }
}

#[tauri::command]
async fn backend_connection(
    app: tauri::AppHandle,
    state: tauri::State<'_, Backend>,
    retry: Option<bool>,
) -> Result<Connection, String> {
    let connection = {
        let mut backend = state.lock().map_err(|error| error.to_string())?;
        if backend.stopping {
            return Err("AgentScope đang đóng.".into());
        }
        backend.check_exit()?;
        if backend.process.is_none() && retry.unwrap_or(false) {
            match start_backend(&app) {
                Ok(process) => {
                    backend.process = Some(process);
                    backend.error = None;
                }
                Err(error) => backend.error = Some(format!("Không thể khởi động backend: {error}")),
            }
        }
        backend
            .process
            .as_ref()
            .map(|process| process.connection.clone())
            .ok_or_else(|| {
                backend
                    .error
                    .clone()
                    .unwrap_or_else(|| "Backend chưa chạy.".into())
            })?
    };
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_millis(700))
        .build()
        .map_err(|e| e.to_string())?;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(30);
    while tokio::time::Instant::now() < deadline {
        if let Ok(response) = client
            .get(format!("{}/api/health", connection.url))
            .bearer_auth(&connection.token)
            .send()
            .await
        {
            if response.status().is_success() {
                return Ok(connection);
            }
        }
        {
            let mut backend = state.lock().map_err(|error| error.to_string())?;
            backend.check_exit()?;
            if let Some(error) = &backend.error {
                return Err(error.clone());
            }
            if backend.stopping
                || backend.process.as_ref().map(|p| &p.connection.url) != Some(&connection.url)
            {
                return Err("Kết nối backend đã thay đổi. Hãy thử lại.".into());
            }
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    let backend = state.lock().map_err(|error| error.to_string())?;
    let log = backend
        .process
        .as_ref()
        .map(|process| process.log_path.display().to_string());
    Err(match log {
        Some(path) => format!("Backend chưa phản hồi sau 30 giây. Nhật ký: {path}"),
        None => "Backend chưa phản hồi sau 30 giây.".into(),
    })
}

fn start_backend(app: &tauri::AppHandle) -> Result<BackendProcess, Box<dyn std::error::Error>> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    drop(listener);
    let token = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let data_dir = std::env::var_os("AGENTSCOPE_DATA_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or(app.path().app_local_data_dir()?);
    std::fs::create_dir_all(&data_dir)?;
    let log_path = data_dir.join("backend-startup.log");
    let mut startup_log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)?;
    writeln!(startup_log, "\n[AgentScope] Khởi động backend cục bộ")?;
    let connection = Connection {
        url: format!("http://127.0.0.1:{port}"),
        token: token.clone(),
    };
    let mut command;
    if cfg!(debug_assertions) {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .ok_or("Project root missing")?;
        let backend_root = std::env::var_os("AGENTSCOPE_BACKEND_DIR")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| {
                root.parent()
                    .expect("workspace directory")
                    .join("AgentScope-Backend")
            });
        let python = std::env::var_os("AGENTSCOPE_BACKEND_PYTHON")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| backend_root.join(".venv/Scripts/python.exe"));
        if !python.is_file() {
            return Err(
                "Không tìm thấy Python trong AgentScope-Backend. Chạy scripts/setup.ps1 của backend hoặc đặt AGENTSCOPE_BACKEND_DIR.".into(),
            );
        }
        command = Command::new(python);
        command
            .args(["-m", "agentscope"])
            .current_dir(&backend_root);
    } else {
        let executable = std::env::current_exe()?
            .parent()
            .ok_or("Application directory missing")?
            .join("agentscope-backend.exe");
        if !executable.is_file() {
            return Err("Thiếu agentscope-backend.exe. Hãy cài lại bản desktop đầy đủ.".into());
        }
        command = Command::new(executable);
    }
    command
        .args([
            "--port",
            &port.to_string(),
            "--parent-pid",
            &std::process::id().to_string(),
            "--data-dir",
        ])
        .arg(&data_dir)
        .env("AGENTSCOPE_TOKEN", token)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::from(startup_log));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    #[cfg(windows)]
    let job = lifecycle::ProcessTreeJob::new()?;
    let mut child = command.spawn()?;
    #[cfg(windows)]
    if let Err(error) = job.assign(&child) {
        let _ = child.kill();
        let _ = child.wait();
        return Err(error.into());
    }
    Ok(BackendProcess {
        connection,
        child,
        log_path,
        #[cfg(windows)]
        _job: job,
    })
}

fn stop_backend(backend: &Backend) {
    let mut process = match backend.lock() {
        Ok(mut state) => {
            state.stopping = true;
            state.process.take()
        }
        Err(_) => None,
    };
    let Some(process) = &mut process else { return };
    // Ask Python to finish cooperatively, then reap it. The parent watcher also handles crashes.
    let connection = process.connection.clone();
    let _ = std::thread::spawn(move || {
        if let Ok(client) = reqwest::blocking::Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(2))
            .build()
        {
            let _ = client
                .post(format!("{}/api/shutdown", connection.url))
                .bearer_auth(connection.token)
                .send();
        }
    })
    .join();
    for _ in 0..30 {
        if matches!(process.child.try_wait(), Ok(Some(_))) {
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    let _ = process.child.kill();
    let _ = process.child.wait();
}

fn main() {
    let app = tauri::Builder::default()
        .setup(|app| {
            let mut backend = BackendState::default();
            match start_backend(app.handle()) {
                Ok(process) => backend.process = Some(process),
                Err(error) => backend.error = Some(format!("Không thể khởi động backend: {error}")),
            }
            app.manage(Mutex::new(backend));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![backend_connection])
        .build(tauri::generate_context!())
        .expect("Không thể tạo cửa sổ AgentScope");
    app.run(|handle, event| {
        if let tauri::RunEvent::Exit = event {
            stop_backend(&handle.state::<Backend>());
        }
    });
}
