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
      updateAvailable: 'Update available', update: 'Update', storageUnavailable: 'Storage is unavailable — export a backup', sorted: 'Sorted by project', copied: 'Copied', couldNotCopy: 'Could not copy', stageDeleted: 'Stage deleted', taskArchived: 'Task archived', projectDeleted: 'Project deleted', backupSaved: 'Backup saved', invalidBackup: 'That file is not a board backup', reportCopied: 'Report copied', nothingMoved: 'Nothing moved', thisWeek: 'This week', lastWeek: 'Last week', noArchived: 'Nothing archived yet.', noProject: 'No project', new: 'New',
    },
    es: {
      search: 'Buscar', more: 'Más opciones', report: 'Informe semanal', newTask: 'Nueva tarea',
      task: 'Tarea', what: '¿Qué hay que hacer?', notes: 'Notas', project: 'Proyecto', session: 'Sesión', copy: 'Copiar', archive: 'Archivar', flag: 'Destacar', unflag: 'Quitar destacado', save: 'Guardar',
      weeklyReport: 'Informe semanal', previousWeek: 'Semana anterior', nextWeek: 'Semana siguiente', close: 'Cerrar', selectAll: 'Seleccionar todo', selectNone: 'No seleccionar nada', copyMarkdown: 'Copiar Markdown', download: 'Descargar .md',
      projects: 'Proyectos', newProject: 'Nuevo proyecto', add: 'Añadir', deleteAll: 'Eliminar todo', undo: 'Deshacer',
      theme: 'Cambiar tema', compact: 'Tarjetas compactas', addStage: 'Añadir etapa', sortProject: 'Ordenar por proyecto', archiveFinished: 'Archivar finalizadas', export: 'Exportar copia', import: 'Importar copia', language: 'Idioma',
      all: 'Todo', flagged: 'Destacadas', none: 'Ninguno', delete: 'Eliminar', restore: 'Restaurar', sure: '¿Seguro?', today: 'hoy', yesterday: 'ayer', untitled: 'Sin título',
      updateAvailable: 'Hay una actualización disponible', update: 'Actualizar', storageUnavailable: 'El almacenamiento no está disponible — exporta una copia', sorted: 'Ordenado por proyecto', copied: 'Copiado', couldNotCopy: 'No se pudo copiar', stageDeleted: 'Etapa eliminada', taskArchived: 'Tarea archivada', projectDeleted: 'Proyecto eliminado', backupSaved: 'Copia guardada', invalidBackup: 'Ese archivo no es una copia del tablero', reportCopied: 'Informe copiado', nothingMoved: 'Nada se movió', thisWeek: 'Esta semana', lastWeek: 'La semana pasada', noArchived: 'Aún no hay nada archivado.', noProject: 'Sin proyecto', new: 'Nuevo',
    },
  };
  const valid = x => x === 'es' ? 'es' : 'en';
  const t = (locale, key, vars = {}) => (copy[valid(locale)][key] || copy.en[key] || key)
    .replace(/\{(\w+)\}/g, (_, name) => vars[name] == null ? '' : vars[name]);
  return { valid, t };
})();

if (typeof window !== 'undefined') window.BoardI18n = BoardI18n;
