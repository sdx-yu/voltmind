#[cfg(not(mobile))]
use std::{
  fs,
  net::{TcpListener, TcpStream},
  sync::Mutex,
  thread,
  time::Duration,
};
#[cfg(not(mobile))]
use tauri::{
  menu::{AboutMetadata, MenuBuilder, MenuItem, SubmenuBuilder},
  Manager, WebviewUrl, WebviewWindowBuilder,
};
#[cfg(not(mobile))]
use tauri_plugin_shell::{process::{CommandChild, CommandEvent}, ShellExt};

#[cfg(not(mobile))]
struct SidecarState(Mutex<Option<CommandChild>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  #[cfg(mobile)]
  run_mobile();

  #[cfg(not(mobile))]
  run_desktop();
}

#[cfg(mobile)]
fn run_mobile() {
  tauri::Builder::default()
    .on_page_load(|webview, payload| {
      if payload.event() == tauri::webview::PageLoadEvent::Finished {
        let _ = webview.eval(r#"
          window.setTimeout(async () => {
            const root = document.getElementById('root');
            if (!root || root.childElementCount > 0) return;
            try {
              if (typeof window.__BBD_MOUNT_APPLICATION__ !== 'function') {
                const entry = Array.from(document.scripts).find((script) => script.type === 'module' && script.src)?.src;
                if (entry) await import(entry);
              }
              window.__BBD_MOUNT_APPLICATION__?.();
              await new Promise((resolve) => window.setTimeout(resolve, 800));
            } catch {}
            if (root.childElementCount > 0) return;
            const fallback = document.createElement('main');
            fallback.style.cssText = 'box-sizing:border-box;min-height:100dvh;padding:64px 28px;background:#f3efe6;color:#292722;font:16px/1.7 -apple-system,BlinkMacSystemFont,sans-serif;text-align:center;';
            const title = document.createElement('h1');
            title.textContent = '笔不怠暂时未能打开';
            const description = document.createElement('p');
            description.textContent = '你的本机记录没有被改动，请完全退出应用后重新打开。';
            const retry = document.createElement('button');
            retry.textContent = '重新打开';
            retry.style.cssText = 'min-height:48px;padding:0 24px;border:0;border-radius:12px;background:#2f6650;color:white;font:inherit;font-weight:700;';
            retry.addEventListener('click', () => location.reload());
            fallback.append(title, description, retry);
            root.appendChild(fallback);
          }, 250);
        "#);
      }
    })
    .run(tauri::generate_context!())
    .expect("笔不怠 iPad 测试程序启动失败");
}

#[cfg(not(mobile))]
fn run_desktop() {
  let application = tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .manage(SidecarState(Mutex::new(None)))
    .setup(|app| {
      let data_dir = app.path().app_data_dir()?;
      fs::create_dir_all(&data_dir)?;
      let resource_dir = app.path().resource_dir()?;
      let direct_static_dir = resource_dir.join("dist");
      let static_dir = if direct_static_dir.exists() { direct_static_dir } else { resource_dir.join("_up_").join("dist") };
      let listener = TcpListener::bind(("127.0.0.1", 0))?;
      let port = listener.local_addr()?.port();
      drop(listener);

      let command = app
        .shell()
        .sidecar("bibudai-server")?
        .env("NODE_ENV", "production")
        .env("BBD_HOST", "127.0.0.1")
        .env("BBD_PORT", port.to_string())
        .env("BBD_DATA_DIR", data_dir.to_string_lossy().to_string())
        .env("BBD_DIST_DIR", static_dir.to_string_lossy().to_string());
      let (mut events, child) = command.spawn()?;
      app.state::<SidecarState>().0.lock().unwrap().replace(child);
      tauri::async_runtime::spawn(async move {
        while let Some(event) = events.recv().await {
          match event {
            CommandEvent::Stdout(bytes) => eprintln!("[sidecar] {}", String::from_utf8_lossy(&bytes)),
            CommandEvent::Stderr(bytes) => eprintln!("[sidecar:error] {}", String::from_utf8_lossy(&bytes)),
            _ => {}
          }
        }
      });

      WebviewWindowBuilder::new(app, "main", WebviewUrl::External("about:blank".parse()?))
        .title("笔不怠")
        .inner_size(1440.0, 920.0)
        .min_inner_size(980.0, 680.0)
        .center()
        .build()?;

      install_app_menu(app)?;

      let app_handle = app.handle().clone();
      thread::spawn(move || {
        for _ in 0..160 {
          if TcpStream::connect(("127.0.0.1", port)).is_ok() {
            if let Some(window) = app_handle.get_webview_window("main") {
              let _ = window.navigate(format!("http://127.0.0.1:{port}").parse().unwrap());
            }
            return;
          }
          thread::sleep(Duration::from_millis(50));
        }
      });
      Ok(())
    })
    .on_menu_event(|app, event| {
      let id = event.id().as_ref();
      if !id.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_') {
        return;
      }
      if let Some(window) = app.get_webview_window("main") {
        let _ = window.eval(&format!(
          "window.dispatchEvent(new CustomEvent('bbd:command', {{ detail: '{id}' }}))"
        ));
      }
    })
    .build(tauri::generate_context!())
    .expect("笔不怠桌面程序构建失败");
  application.run(|app, event| {
    if matches!(event, tauri::RunEvent::Exit) {
      if let Some(child) = app.state::<SidecarState>().0.lock().unwrap().take() {
        let _ = child.kill();
      }
    }
  });
}

#[cfg(not(mobile))]
fn install_app_menu(app: &tauri::App) -> tauri::Result<()> {
  let settings = MenuItem::with_id(app, "settings", "设置…", true, Some("CmdOrCtrl+,"))?;
  let command_palette = MenuItem::with_id(app, "command-palette", "命令面板…", true, Some("CmdOrCtrl+K"))?;
  let search = MenuItem::with_id(app, "search", "查找", true, Some("CmdOrCtrl+F"))?;
  let replace = MenuItem::with_id(app, "replace", "查找与替换", true, Some("CmdOrCtrl+Shift+F"))?;
  let focus = MenuItem::with_id(app, "focus", "进入专注", true, Some("CmdOrCtrl+Shift+."))?;
  let tree = MenuItem::with_id(app, "toggle-tree", "显示书稿树", true, Some("CmdOrCtrl+\\"))?;
  let inspector = MenuItem::with_id(app, "toggle-inspector", "显示检查器", true, Some("CmdOrCtrl+Shift+I"))?;
  let read_aloud = MenuItem::with_id(app, "read-aloud", "本地朗读", true, None::<&str>)?;
  let write = MenuItem::with_id(app, "view-write", "写作", true, Some("CmdOrCtrl+1"))?;
  let plan = MenuItem::with_id(app, "view-plan", "规划", true, Some("CmdOrCtrl+2"))?;
  let canon = MenuItem::with_id(app, "view-canon", "正典", true, Some("CmdOrCtrl+3"))?;
  let revision = MenuItem::with_id(app, "view-revision", "修订", true, Some("CmdOrCtrl+4"))?;
  let deliver = MenuItem::with_id(app, "view-deliver", "交付", true, Some("CmdOrCtrl+5"))?;
  let sprint = MenuItem::with_id(app, "view-sprint", "安静冲刺", true, None::<&str>)?;
  let visual = MenuItem::with_id(app, "view-visual", "视觉故事板", true, None::<&str>)?;
  let template = MenuItem::with_id(app, "view-template", "结构模板", true, None::<&str>)?;
  let review = MenuItem::with_id(app, "view-review", "角色化审阅", true, None::<&str>)?;
  let provenance = MenuItem::with_id(app, "view-provenance", "创作来源", true, None::<&str>)?;
  let sync = MenuItem::with_id(app, "view-sync", "本地加密接力（文件）", true, None::<&str>)?;
  let help = MenuItem::with_id(app, "help", "帮助与恢复", true, None::<&str>)?;
  let backup = MenuItem::with_id(app, "help", "备份与恢复说明", true, None::<&str>)?;
  let about = AboutMetadata {
    name: Some("笔不怠".into()),
    version: Some(env!("CARGO_PKG_VERSION").into()),
    copyright: Some("本地优先，正文不进遥测".into()),
    ..Default::default()
  };

  let menu = MenuBuilder::new(app)
    .item(
      &SubmenuBuilder::new(app, "笔不怠")
        .about_with_text("关于笔不怠", Some(about))
        .separator()
        .item(&settings)
        .separator()
        .hide_with_text("隐藏笔不怠")
        .hide_others_with_text("隐藏其他")
        .show_all()
        .separator()
        .quit_with_text("退出笔不怠")
        .build()?,
    )
    .item(
      &SubmenuBuilder::new(app, "文件")
        .text("bookshelf", "返回书架")
        .separator()
        .text("trash", "项目回收站")
        .separator()
        .close_window_with_text("关闭窗口")
        .build()?,
    )
    .item(
      &SubmenuBuilder::new(app, "编辑")
        .undo_with_text("撤销")
        .redo_with_text("重做")
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all_with_text("全选")
        .separator()
        .item(&command_palette)
        .item(&search)
        .item(&replace)
        .build()?,
    )
    .item(
      &SubmenuBuilder::new(app, "显示")
        .item(&focus)
        .item(&tree)
        .item(&inspector)
        .item(&read_aloud)
        .separator()
        .fullscreen_with_text("进入全屏幕")
        .build()?,
    )
    .item(
      &SubmenuBuilder::new(app, "前往")
        .item(&write)
        .item(&plan)
        .item(&canon)
        .item(&revision)
        .item(&deliver)
        .separator()
        .item(&sprint)
        .item(&visual)
        .item(&template)
        .item(&review)
        .item(&provenance)
        .item(&sync)
        .build()?,
    )
    .item(
      &SubmenuBuilder::new(app, "窗口")
        .minimize_with_text("最小化")
        .build()?,
    )
    .item(
      &SubmenuBuilder::new(app, "帮助")
        .item(&help)
        .item(&backup)
        .build()?,
    )
    .build()?;
  app.set_menu(menu)?;
  Ok(())
}
