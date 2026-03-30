const archiver = require('archiver');

/**
 * Builds an in-memory ZIP archive from a files array and pipes it to the response.
 * @param {Array} files - Array of {name, path, content} objects
 * @param {Object} res - Express response object
 * @param {string} pluginName - Plugin name for the zip filename
 */
function buildZip(files, res, pluginName) {
  return new Promise((resolve, reject) => {
    const sanitizedName = (pluginName || 'plugin').replace(/[^a-zA-Z0-9_-]/g, '_');
    
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${sanitizedName}.zip"`);

    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.on('error', (err) => {
      reject(err);
    });

    archive.on('end', () => {
      resolve();
    });

    archive.pipe(res);

    for (const file of files) {
      if (!file.content || !file.path) continue;
      archive.append(file.content, { name: file.path });
    }

    archive.finalize();
  });
}

module.exports = { buildZip };
