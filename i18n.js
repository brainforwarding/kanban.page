/* Interface copy only. Board content deliberately never passes through here. */
const BoardI18n = (() => {
  const copy = {
    en: {
      search: 'Search', more: 'More', report: 'Weekly report', newTask: 'New task',
      task: 'Task', what: 'What needs doing?', notes: 'Notes', project: 'Project', session: 'Session', copy: 'Copy', archive: 'Archive', flag: 'Flag', unflag: 'Unflag', save: 'Save',
      weeklyReport: 'Weekly report', previousWeek: 'Previous week', nextWeek: 'Next week', close: 'Close', selectAll: 'Select all', selectNone: 'Select none', copyMarkdown: 'Copy markdown', download: 'Download .md',
      projects: 'Projects', newProject: 'New project', add: 'Add', deleteAll: 'Delete all', undo: 'Undo',
      theme: 'Toggle theme', compact: 'Compact cards', addStage: 'Add stage', sortProject: 'Sort by project', archiveFinished: 'Archive finished', export: 'Export backup', import: 'Import backup', language: 'Language',
      all: 'All', flagged: 'Flagged', none: 'None', delete: 'Delete', restore: 'Restore', sure: 'Sure?', today: 'today', yesterday: 'yesterday', untitled: 'Untitled',
      updateAvailable: 'Update available', update: 'Update', storageUnavailable: 'Storage is unavailable — export a backup', sorted: 'Sorted by project', copied: 'Copied', couldNotCopy: 'Could not copy', stageDeleted: 'Stage deleted', taskArchived: 'Task archived', projectDeleted: 'Project deleted', backupSaved: 'Backup saved', invalidBackup: 'That file is not a board backup', reportCopied: 'Report copied', nothingMoved: 'Nothing moved', thisWeek: 'This week', lastWeek: 'Last week', noArchived: 'Nothing archived yet.', discard: 'Discard', archiveVerb: 'Archive', reorder: 'Drag to reorder', shipped: 'Shipped', inFlight: 'In flight', offBoard: 'no longer on the board', tickToExport: 'tick a row to export', new: 'New',
      syncDevices: 'Sync devices', sync: 'Sync',
      syncPitch: 'The same board on your phone, live as you work. No account — a secret link pairs your devices, and the server only ever sees encrypted bytes.',
      enableSync: 'Enable sync', syncScanLine: 'Scan this, or open the link, on your other device.',
      pairingLink: 'Pairing link', syncWarning: 'Anyone with this link can read and edit this board. Treat it like a password.',
      stopSync: 'Stop syncing', deleteFromServer: 'Delete from server',
      syncLive: 'live · {when}', syncedAt: 'synced · {when}', syncing: 'syncing…',
      syncOffline: 'offline · will retry', syncNoAnswer: 'no answer · will retry',
      syncGone: 'not on server · stopped', syncTooBig: 'board too large · not sent',
      pairingStatus: 'pairing…', linkNotFound: 'link not found',
      adopting: 'Bringing your board to this device.',
      adoptBadLink: 'This link no longer opens a board. Copy a fresh one from Sync devices on your other device.',
      adoptOffline: 'Could not reach the server. The link still works — try again when you are back online.',
      tryAgain: 'Try again', paired: 'Paired — {n} cards', merged: 'Merged with this device’s board',
      syncStopped: 'Sync stopped on this device', serverDeleted: 'Deleted from the server',
      syncFailed: 'Could not enable sync',
      syncLost: 'Sync stopped — this board is no longer on the server',
    },
    es: {
      search: 'Buscar', more: 'Más opciones', report: 'Informe semanal', newTask: 'Nueva tarea',
      task: 'Tarea', what: '¿Qué hay que hacer?', notes: 'Notas', project: 'Proyecto', session: 'Sesión', copy: 'Copiar', archive: 'Archivar', flag: 'Destacar', unflag: 'Quitar destacado', save: 'Guardar',
      weeklyReport: 'Informe semanal', previousWeek: 'Semana anterior', nextWeek: 'Semana siguiente', close: 'Cerrar', selectAll: 'Seleccionar todo', selectNone: 'No seleccionar nada', copyMarkdown: 'Copiar Markdown', download: 'Descargar .md',
      projects: 'Proyectos', newProject: 'Nuevo proyecto', add: 'Añadir', deleteAll: 'Eliminar todo', undo: 'Deshacer',
      theme: 'Cambiar tema', compact: 'Tarjetas compactas', addStage: 'Añadir etapa', sortProject: 'Ordenar por proyecto', archiveFinished: 'Archivar finalizadas', export: 'Exportar copia', import: 'Importar copia', language: 'Idioma',
      all: 'Todo', flagged: 'Destacadas', none: 'Ninguno', delete: 'Eliminar', restore: 'Restaurar', sure: '¿Seguro?', today: 'hoy', yesterday: 'ayer', untitled: 'Sin título',
      updateAvailable: 'Hay una actualización disponible', update: 'Actualizar', storageUnavailable: 'El almacenamiento no está disponible — exporta una copia', sorted: 'Ordenado por proyecto', copied: 'Copiado', couldNotCopy: 'No se pudo copiar', stageDeleted: 'Etapa eliminada', taskArchived: 'Tarea archivada', projectDeleted: 'Proyecto eliminado', backupSaved: 'Copia guardada', invalidBackup: 'Ese archivo no es una copia del tablero', reportCopied: 'Informe copiado', nothingMoved: 'Nada se movió', thisWeek: 'Esta semana', lastWeek: 'La semana pasada', noArchived: 'Aún no hay nada archivado.', discard: 'Descartar', archiveVerb: 'Archivar', reorder: 'Arrastra para reordenar', shipped: 'Entregado', inFlight: 'En marcha', offBoard: 'ya no está en el tablero', tickToExport: 'marca una fila para exportar', new: 'Nuevo',
      syncDevices: 'Sincronizar dispositivos', sync: 'Sincronización',
      syncPitch: 'El mismo tablero en tu teléfono, en vivo mientras trabajas. Sin cuenta — un enlace secreto vincula tus dispositivos, y el servidor solo ve bytes cifrados.',
      enableSync: 'Activar sincronización', syncScanLine: 'Escanéalo, o abre el enlace, en tu otro dispositivo.',
      pairingLink: 'Enlace de vinculación', syncWarning: 'Cualquiera con este enlace puede leer y editar este tablero. Trátalo como una contraseña.',
      stopSync: 'Dejar de sincronizar', deleteFromServer: 'Eliminar del servidor',
      syncLive: 'en vivo · {when}', syncedAt: 'sincronizado · {when}', syncing: 'sincronizando…',
      syncOffline: 'sin conexión · reintentará', syncNoAnswer: 'sin respuesta · reintentará',
      syncGone: 'no está en el servidor · detenido', syncTooBig: 'tablero muy grande · no se envió',
      pairingStatus: 'vinculando…', linkNotFound: 'enlace no encontrado',
      adopting: 'Trayendo tu tablero a este dispositivo.',
      adoptBadLink: 'Este enlace ya no abre ningún tablero. Copia uno nuevo desde Sincronizar dispositivos en tu otro dispositivo.',
      adoptOffline: 'No se pudo contactar al servidor. El enlace sigue sirviendo — inténtalo cuando vuelvas a tener conexión.',
      tryAgain: 'Reintentar', paired: 'Vinculado — {n} tarjetas', merged: 'Combinado con el tablero de este dispositivo',
      syncStopped: 'Sincronización detenida en este dispositivo', serverDeleted: 'Eliminado del servidor',
      syncFailed: 'No se pudo activar la sincronización',
      syncLost: 'Sincronización detenida — este tablero ya no está en el servidor',
    },
  };
  const valid = x => x === 'es' ? 'es' : 'en';
  const t = (locale, key, vars = {}) => (copy[valid(locale)][key] || copy.en[key] || key)
    .replace(/\{(\w+)\}/g, (_, name) => vars[name] == null ? '' : vars[name]);
  return { valid, t };
})();

if (typeof window !== 'undefined') window.BoardI18n = BoardI18n;
