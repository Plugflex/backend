const express = require('express');
const router = express.Router();
const fs = require('fs-extra');
const { generatePlugin } = require('../controllers/pluginController');
const { buildZip } = require('../utils/zipBuilder');
const { compilePlugin, generatePomXml, generateBuildGradle, generateSettingsGradle } = require('../utils/jarCompiler');

// POST /api/generate-plugin
router.post('/generate-plugin', async (req, res) => {
  try {
    const { prompt, version } = req.body;
    if (!prompt || prompt.trim().length < 3) {
      return res.status(400).json({ success: false, error: 'Please provide a plugin description.' });
    }

    console.log(`[PluginForge] Generating plugin for: "${prompt}" (Version: ${version || '1.20+'})`);
    const pluginData = await generatePlugin(prompt.trim(), version || '1.20+');
    
    // Inject build.gradle, settings.gradle, and pom.xml into the plugin files structure
    pluginData.files.push({ name: 'build.gradle', path: 'build.gradle', content: generateBuildGradle(pluginData, version || '1.20+'), language: 'gradle' });
    pluginData.files.push({ name: 'settings.gradle', path: 'settings.gradle', content: generateSettingsGradle(pluginData), language: 'gradle' });
    pluginData.files.push({ name: 'pom.xml', path: 'pom.xml', content: generatePomXml(pluginData, version || '1.20+'), language: 'xml' });

    console.log(`[PluginForge] Generated: ${pluginData.pluginName} with ${pluginData.files.length} files`);
    res.json({ success: true, plugin: pluginData });

  } catch (err) {
    console.error('[PluginForge] Generation error:', err.message);
    res.status(500).json({ 
      success: false, 
      error: err.message || 'Failed to generate plugin. Please try again.' 
    });
  }
});

// POST /api/update-plugin
router.post('/update-plugin', async (req, res) => {
  try {
    const { prompt, pluginData, version } = req.body;
    if (!prompt || prompt.trim().length < 3) {
      return res.status(400).json({ success: false, error: 'Please provide instructions for what to change.' });
    }
    if (!pluginData) {
      return res.status(400).json({ success: false, error: 'No existing plugin data provided.' });
    }

    // Remove the injected build files so the AI doesn't get confused or try to overwrite them unnecessarily
    const filteredFiles = pluginData.files.filter(f => !['build.gradle', 'settings.gradle', 'pom.xml'].includes(f.name));
    const cleanPluginData = { ...pluginData, files: filteredFiles };

    console.log(`[PluginForge] Updating plugin: "${prompt}"`);
    const { updatePlugin } = require('../controllers/pluginController');
    const updatedPluginData = await updatePlugin(cleanPluginData, prompt.trim(), version || '1.20+');
    
    // Re-inject build files
    updatedPluginData.files.push({ name: 'build.gradle', path: 'build.gradle', content: generateBuildGradle(updatedPluginData, version || '1.20+'), language: 'gradle' });
    updatedPluginData.files.push({ name: 'settings.gradle', path: 'settings.gradle', content: generateSettingsGradle(updatedPluginData), language: 'gradle' });
    updatedPluginData.files.push({ name: 'pom.xml', path: 'pom.xml', content: generatePomXml(updatedPluginData, version || '1.20+'), language: 'xml' });

    console.log(`[PluginForge] Updated: ${updatedPluginData.pluginName} with ${updatedPluginData.files.length} files`);
    res.json({ success: true, plugin: updatedPluginData });

  } catch (err) {
    console.error('[PluginForge] Update error:', err.message);
    res.status(500).json({ success: false, error: err.message || 'Failed to update plugin.' });
  }
});

// POST /api/download-zip
router.post('/download-zip', async (req, res) => {
  try {
    const { files, pluginName, version, buildSystem } = req.body;
    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ success: false, error: 'No files provided for ZIP creation.' });
    }

    console.log(`[PluginForge] Building ZIP for: ${pluginName} (${buildSystem || 'Maven'})`);

    // build.gradle and pom.xml might already be in files from generate-plugin
    const filesToZip = [...files];
    const dummyPluginData = { pluginName, version: '1.0.0' };
    
    const hasGradle = files.some(f => f.name === 'build.gradle');
    if (buildSystem === 'Gradle' && !hasGradle) {
      filesToZip.push({ path: 'build.gradle', content: generateBuildGradle(dummyPluginData, version || '1.20.4') });
      filesToZip.push({ path: 'settings.gradle', content: generateSettingsGradle(dummyPluginData) });
    } else if (buildSystem !== 'Gradle' && !files.some(f => f.name === 'pom.xml')) {
      filesToZip.push({ path: 'pom.xml', content: generatePomXml(dummyPluginData, version || '1.20.4') });
    }

    await buildZip(filesToZip, res, pluginName);

  } catch (err) {
    console.error('[PluginForge] ZIP error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: 'Failed to create ZIP archive.' });
    }
  }
});

// POST /api/compile-jar
router.post('/compile-jar', async (req, res) => {
  const { pluginData, version, buildSystem } = req.body;
  if (!pluginData) {
    return res.status(400).json({ success: false, error: 'No plugin data provided.' });
  }

  // Use Server-Sent Events for real-time compilation progress
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    sendEvent({ type: 'progress', message: `🚀 Starting ${buildSystem || 'Maven'} compilation...`, stage: 'start' });

    const result = await compilePlugin(pluginData, version || '1.20.4', buildSystem || 'Maven', (progress) => {
      sendEvent({ type: 'progress', ...progress });
    });

    // Read the JAR file and send as base64
    const jarBuffer = await fs.readFile(result.jarPath);
    const jarBase64 = jarBuffer.toString('base64');
    const jarName = `${(pluginData.pluginName || 'plugin').replace(/[^a-zA-Z0-9_-]/g, '_')}-${pluginData.version || '1.0.0'}.jar`;

    sendEvent({ 
      type: 'complete', 
      success: true, 
      jarName,
      jarData: jarBase64,
      fixedData: result.fixedData,
      message: '✅ Compilation successful!'
    });

    // Cleanup temp dir
    await fs.remove(result.tempDir).catch(() => {});

  } catch (err) {
    console.error('[PluginForge] Compile error:', err.message);
    sendEvent({ type: 'error', success: false, message: err.message });
  } finally {
    res.end();
  }
});

module.exports = router;
