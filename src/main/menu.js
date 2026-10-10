'use strict';

/* MAZ-FATORA — menu applicatif natif (process principal).
   - Fonction PURE : construit le gabarit (Menu.buildFromTemplate) à partir de
     la langue courante et d'actions fournies. main.js l'installe ; les tests
     unitaires l'inspectent sans Electron.
   - Les actions « lock / settings / help / guide » sont envoyées au renderer
     par main.js via le canal « menu:action » (preload : onMenuAction).
   - Les rôles natifs (copier/coller, zoom, quitter…) restent ceux d'Electron. */

function buildMenuTemplate(ctx) {
  const tr = ctx && ctx.tr;
  const isMac = !!(ctx && ctx.isMac);
  const appName = (ctx && ctx.appName) || 'MAZ-FATORA';
  const aboutCb = (ctx && ctx.onAbout) || null;
  const act = (name) => () => { if (ctx && ctx.onAction) ctx.onAction(name); };
  const about = () => { if (aboutCb) aboutCb(); };

  const template = [];

  /* macOS : premier menu = menu de l'application (Quitter en ⌘Q). */
  if (isMac) {
    template.push({
      label: appName,
      submenu: [
        { label: tr('menu.about'), click: about },
        { type: 'separator' },
        { label: tr('menu.services'), role: 'services' },
        { type: 'separator' },
        { label: tr('menu.hide'), role: 'hide' },
        { label: tr('menu.hideOthers'), role: 'hideOthers' },
        { label: tr('menu.showAll'), role: 'unhide' },
        { type: 'separator' },
        { label: tr('menu.quit'), role: 'quit' }
      ]
    });
  } else {
    /* Windows / Linux : l'accès Quitter vit dans le menu Fichier. */
    template.push({
      label: tr('menu.file'),
      submenu: [
        { label: tr('menu.quit'), accelerator: 'CmdOrCtrl+Q', role: 'quit' }
      ]
    });
  }

  template.push({
    label: tr('menu.edit'),
    submenu: [
      { label: tr('menu.undo'), role: 'undo' },
      { label: tr('menu.redo'), role: 'redo' },
      { type: 'separator' },
      { label: tr('menu.cut'), role: 'cut' },
      { label: tr('menu.copy'), role: 'copy' },
      { label: tr('menu.paste'), role: 'paste' },
      { label: tr('menu.selectAll'), role: 'selectAll' }
    ]
  });

  template.push({
    label: tr('menu.view'),
    submenu: [
      { label: tr('menu.zoomIn'), role: 'zoomIn' },
      { label: tr('menu.zoomOut'), role: 'zoomOut' },
      { label: tr('menu.zoomReset'), role: 'resetZoom' },
      { type: 'separator' },
      { label: tr('menu.fullscreen'), role: 'togglefullscreen' }
    ]
  });

  template.push({
    label: tr('menu.security'),
    submenu: [
      { label: tr('menu.lock'), accelerator: 'CmdOrCtrl+L', click: act('lock') },
      { label: tr('menu.settings'), accelerator: 'CmdOrCtrl+,', click: act('settings') }
    ]
  });

  const helpSub = [
    { label: tr('menu.helpCenter'), accelerator: 'F1', click: act('help') },
    { label: tr('menu.userGuide'), click: act('guide') }
  ];
  if (!isMac) {
    helpSub.push({ type: 'separator' });
    helpSub.push({ label: tr('menu.about'), click: about });
  }
  template.push({ label: tr('menu.help'), role: 'help', submenu: helpSub });

  return template;
}

module.exports = { buildMenuTemplate };