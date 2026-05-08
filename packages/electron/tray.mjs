import { Tray, Menu, nativeImage } from 'electron';
import log from 'electron-log/main.js';

const buildContextMenu = ({ onShowWindow, onQuit, getMode }) => {
  const mode = typeof getMode === 'function' ? getMode() : 'local';
  const modeLabel = mode === 'local'
    ? 'Mode: Local'
    : `Mode: Remote (${mode})`;

  return Menu.buildFromTemplate([
    { label: 'Open OpenChamber', click: onShowWindow },
    { type: 'separator' },
    { label: modeLabel, enabled: false },
    { type: 'separator' },
    { label: 'Quit OpenChamber', click: onQuit },
  ]);
};

export const createTrayIcon = () => {
  // 16x16 RGBA buffer: white diamond on transparent background.
  const size = 16;
  const channels = 4;
  const buffer = Buffer.alloc(size * size * channels, 0);

  // Draw a filled diamond shape centered in the 16x16 grid.
  //   Row 0-1:  cols 6-9  (top point)
  //   Row 2-3:  cols 4-11
  //   Row 4-5:  cols 2-13
  //   Row 6-9:  cols 0-15 (widest)
  //   Row 10-11: cols 2-13
  //   Row 12-13: cols 4-11
  //   Row 14-15: cols 6-9  (bottom point)
  const rows = [
    { from: 6, to: 9 },
    { from: 6, to: 9 },
    { from: 4, to: 11 },
    { from: 4, to: 11 },
    { from: 2, to: 13 },
    { from: 2, to: 13 },
    { from: 0, to: 15 },
    { from: 0, to: 15 },
    { from: 0, to: 15 },
    { from: 0, to: 15 },
    { from: 2, to: 13 },
    { from: 2, to: 13 },
    { from: 4, to: 11 },
    { from: 4, to: 11 },
    { from: 6, to: 9 },
    { from: 6, to: 9 },
  ];

  for (let row = 0; row < size; row += 1) {
    const { from, to } = rows[row];
    for (let col = from; col <= to; col += 1) {
      const offset = (row * size + col) * channels;
      buffer[offset] = 255;     // R
      buffer[offset + 1] = 255; // G
      buffer[offset + 2] = 255; // B
      buffer[offset + 3] = 255; // A
    }
  }

  return nativeImage.createFromBuffer(buffer, { width: size, height: size });
};

export const createTray = ({ onShowWindow, onQuit, getMode }) => {
  const icon = createTrayIcon();
  const tray = new Tray(icon);
  tray.setToolTip('OpenChamber');

  const contextMenu = buildContextMenu({ onShowWindow, onQuit, getMode });
  tray.setContextMenu(contextMenu);

  // macOS: single-click shows the context menu by default (preferred).
  // Windows/Linux: single-click shows the main window.
  if (process.platform !== 'darwin') {
    tray.on('click', onShowWindow);
  }

  log.info('[tray] system tray created');
  return tray;
};

export const updateTrayMenu = (tray, { onShowWindow, onQuit, getMode }) => {
  if (!tray || tray.isDestroyed()) return;
  const contextMenu = buildContextMenu({ onShowWindow, onQuit, getMode });
  tray.setContextMenu(contextMenu);
};
