// Future desktop host source only. Electron is NOT installed by this project.
const {app,BrowserWindow}=require('electron');
const path=require('node:path');
app.whenReady().then(()=>{const window=new BrowserWindow({width:1440,height:1000,minWidth:900,minHeight:700,backgroundColor:'#101015',webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',event=>event.preventDefault());window.loadFile(path.join(__dirname,'../web/index.html'));});app.on('window-all-closed',()=>app.quit());
