const axios = require('axios');

const SAMBANOVA_URL = 'https://api.sambanova.ai/v1/chat/completions';
const MODEL = 'Meta-Llama-3.3-70B-Instruct';

const SYSTEM_PROMPT = `You are PluginForge AI — a world-class Minecraft Plugin Generator. 
You generate complete, production-ready Minecraft plugins (Bukkit/Spigot/Paper) in Java.

RULES:
1. ALWAYS generate COMPLETE, fully working code — never partial code or placeholders.
2. ALWAYS include plugin.yml, config.yml (if needed), and ALL Java class files.
3. Use proper Java package structure (e.g., com.pluginforge.myplugin).
4. Follow Bukkit/Spigot API best practices.
5. Include proper event listeners, commands, and permissions.
6. ALWAYS respond with valid JSON in EXACTLY this format:

{
  "pluginName": "PluginName",
  "version": "1.0.0",
  "description": "Brief description of the plugin",
  "mainClass": "com.example.pluginname.MainClass",
  "apiVersion": "1.20",
  "commands": ["command1", "command2"],
  "permissions": ["pluginname.use"],
  "files": [
    {
      "name": "plugin.yml",
      "path": "src/main/resources/plugin.yml", 
      "content": "full file content here",
      "language": "yaml"
    },
    {
      "name": "MainClass.java",
      "path": "src/main/java/com/example/pluginname/MainClass.java",
      "content": "full java class content here",
      "language": "java"
    }
  ]
}

Generate ONLY the JSON object. No markdown, no explanations outside the JSON.`;

async function generatePlugin(prompt, version) {
  const apiKey = process.env.SAMBANOVA_API_KEY;
  if (!apiKey || apiKey === 'your_sambanova_api_key_here') {
    throw new Error('SambaNova API key not configured. Please set SAMBANOVA_API_KEY in .env file.');
  }

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Generate a complete Minecraft plugin for version ${version}.\n\nDescription: ${prompt}\n\nMake sure to write code compatible with Paper/Spigot API ${version}. Respond ONLY with the JSON object as specified.` }
  ];

  const response = await axios.post(
    SAMBANOVA_URL,
    {
      model: MODEL,
      messages,
      temperature: 0.4,
      max_tokens: 4000,
      stream: false
    },
    {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 120000
    }
  ).catch(err => {
    // If SambaNova fails, log and re-throw the detailed error instead of generic 500 code
    const aiError = err.response?.data?.error?.message || err.response?.data || err.message;
    throw new Error(`SambaNova AI Error: ${typeof aiError === 'object' ? JSON.stringify(aiError) : aiError}`);
  });

  const content = response.data.choices[0]?.message?.content;
  if (!content) throw new Error('No content returned from SambaNova API');

  // Extract JSON from response (handle cases where model wraps in markdown)
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Invalid response format from AI — expected JSON object');

  const pluginData = JSON.parse(jsonMatch[0]);
  if (!pluginData.files || !Array.isArray(pluginData.files)) {
    throw new Error('Invalid plugin data structure — missing files array');
  }

  return pluginData;
}

async function fixPluginErrors(pluginData, errors) {
  const apiKey = process.env.SAMBANOVA_API_KEY;
  
  const fixPrompt = `The following Minecraft plugin has compilation errors. Fix ALL errors and return the COMPLETE corrected plugin JSON.

PLUGIN DATA:
${JSON.stringify(pluginData, null, 2)}

COMPILATION ERRORS:
${errors}

Return ONLY the corrected JSON object in the same format. Fix every error.`;

  const response = await axios.post(
    SAMBANOVA_URL,
    {
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: fixPrompt }
      ],
      temperature: 0.2,
      max_tokens: 4000,
      stream: false
    },
    {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 120000
    }
  );

  const content = response.data.choices[0]?.message?.content;
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('AI could not fix the errors');

  return JSON.parse(jsonMatch[0]);
}

module.exports = { generatePlugin, fixPluginErrors };
