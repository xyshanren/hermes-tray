; Hermes Tray 安装程序配置
; 使用 Inno Setup 编译

#define AppName "Hermes Tray"
#define AppVersion "0.1.0"
#define AppPublisher "码一"
#define AppURL "https://github.com/NousResearch/hermes-agent"
#define AppExeName "Hermes Tray.exe"

[Setup]
AppId={{8F3D5A2B-1C4E-4F6B-9D3A-7E8C5B6A4F2D}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL}
AppUpdatesURL={#AppURL}
DefaultDirName={autopf}\HermesTray
DefaultGroupName={#AppName}
AllowNoIcons=yes
; 允许用户自定义安装路径
DisableDirPage=no
; 输出文件名
OutputBaseFilename=hermesTray-Setup-{#AppVersion}
; 输出目录
OutputDir=installer
; 压缩
Compression=lzma2/ultra64
SolidCompression=yes
; 权限
PrivilegesRequired=admin
; 图标
SetupIconFile=assets\icon.ico
; 卸载
UninstallDisplayIcon={app}\{#AppExeName}
UninstallDisplayName={#AppName}

[Languages]
Name: "chinesesimplified"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked
Name: "quicklaunchicon"; Description: "{cm:CreateQuickLaunchIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked; OnlyBelowVersion: 6.1; Check: not Is64BitInstallMode

[Files]
; 主程序
Source: "dist\Hermes Tray.exe"; DestDir: "{app}"; Flags: ignoreversion
; 资源文件
Source: "assets\*"; DestDir: "{app}\assets"; Flags: ignoreversion recursesubdirs createallsubdirs
; README
Source: "README.md"; DestDir: "{app}"; Flags: ignoreversion; DestName: "readme.txt"

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExeName}"
Name: "{group}\{cm:ProgramOnTheWeb,{#AppName}}"; Filename: "{#AppURL}"
Name: "{group}\{cm:UninstallProgram,{#AppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; Tasks: desktopicon
Name: "{userappdata}\Microsoft\Internet Explorer\Quick Launch\{#AppName}"; Filename: "{app}\{#AppExeName}"; Tasks: quicklaunchicon

[Registry]
; 开机自启
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "HermesTray"; ValueData: """{app}\{#AppExeName}"" --background"; Flags: uninsdeletevalue

[Run]
Filename: "{app}\{#AppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(AppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}"
