const { app, BrowserWindow, shell } = require('electron')
const { spawn } = require('child_process')
const path = require('path')
const http = require('http')

const PORT = 3000
let nextServer = null
let mainWindow = null

// ---------------------------------------------------------------------------
// Spawn the Next.js standalone server
// ---------------------------------------------------------------------------
function startNextServer() {
  // When packaged with asar, __dirname points inside the asar archive.
  // app.getAppPath() always returns the real path (outside asar).
  const appRoot = app.getAppPath()
  const serverScript = path.join(appRoot, '.next', 'standalone', 'server.js')

  // Electron bundles its own Node.js runtime — reuse it to run server.js.
  // process.execPath is the Electron binary; passing --no-sandbox is harmless.
  nextServer = spawn(process.execPath, ['--no-sandbox', serverScript], {
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: 'production',
      ELECTRON_RUN_AS_NODE: '1',
    },
    stdio: 'pipe',
  })

  nextServer.stdout.on('data', (d) => process.stdout.write(d))
  nextServer.stderr.on('data', (d) => process.stderr.write(d))

  nextServer.on('error', (err) => console.error('Next.js server error:', err))
  nextServer.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`Next.js server exited with code ${code}`)
    }
  })
}

// ---------------------------------------------------------------------------
// Poll until server is ready, then open the window
// ---------------------------------------------------------------------------
function waitForServer(retries = 0) {
  const maxRetries = 60 // 30 s total
  http
    .get(`http://localhost:${PORT}`, () => {
      createWindow()
    })
    .on('error', () => {
      if (retries < maxRetries) {
        setTimeout(() => waitForServer(retries + 1), 500)
      } else {
        console.error('Timeout: Next.js server never became ready')
        app.quit()
      }
    })
}

// ---------------------------------------------------------------------------
// BrowserWindow
// ---------------------------------------------------------------------------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Bitcoin Trader',
    // icon: path.join(app.getAppPath(), 'build-resources', 'icon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  mainWindow.loadURL(`http://localhost:${PORT}`)

  // Open external links in the default browser, not in the app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  startNextServer()
  waitForServer()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (nextServer) {
    nextServer.kill()
    nextServer = null
  }
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (nextServer) {
    nextServer.kill()
    nextServer = null
  }
})
