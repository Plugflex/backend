const axios = require('axios');

const SAMBANOVA_URL = 'https://api.sambanova.ai/v1/chat/completions';
const MODEL = 'Meta-Llama-3.3-70B-Instruct';

const SYSTEM_PROMPT = `You are PluginForge AI — a world-class Minecraft Plugin Generator. 
You generate complete, production-ready Minecraft plugins (Bukkit/Spigot/Paper) in Java.

RULES:
1. ABSOLUTELY NO PLACEHOLDERS: ALWAYS generate COMPLETE, fully working code. NEVER write things like "// Handle player join" or " // TODO: implement". Write EVERY SINGLE LINE OF CODE needed.
2. ALWAYS include plugin.yml, config.yml (if needed), and ALL Java class files.
3. Use proper Java package structure (e.g., com.pluginforge.myplugin).
4. Follow Bukkit/Spigot API best practices.
5. Include proper event listeners, commands, and permissions.
6. IF A PLUGIN IS MASSIVE (>4 classes): DO NOT attempt to write everything at once. Write the 3 MOST IMPORTANT classes completely, and completely omit the others. The user will ask for them later!
7. ALWAYS respond with valid JSON in EXACTLY this format:

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
      max_tokens: 8000,
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
      max_tokens: 8000,
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

async function updatePlugin(currentPluginData, prompt, version) {
  const apiKey = process.env.SAMBANOVA_API_KEY;
  if (!apiKey || apiKey === 'your_sambanova_api_key_here') {
    throw new Error('SambaNova API key not configured.');
  }

  const updatePrompt = `You are updating a Minecraft plugin. The user wants the following modifications:
"${prompt}"

CURRENT PLUGIN JSON:
${JSON.stringify(currentPluginData, null, 2)}

Return a JSON object with at least the "files" array. 
CRITICAL RULES:
1. YOU MUST ONLY INCLUDE FILES THAT YOU ARE UPDATING OR NEWLY CREATING! Do NOT include files that remain unchanged.
2. NO PLACEHOLDERS ALLOWED: When you update a file, you MUST write the entire file code completely without skipping sections.
3. FILE LIMIT: You can ONLY return a MAXIMUM OF 3 FILES per response. If there are more than 3 files to write, just write the first 3 completely, and tell the user you'll do the rest later. DO NOT truncate files!
If the user asks you to write "all the codes", pick the top 3 unwritten classes and write them COMPLETELY. Avoid partial generation at all costs. Maintain the exact same JSON format.`;

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: updatePrompt }
  ];

  const response = await axios.post(
    SAMBANOVA_URL,
    {
      model: MODEL,
      messages,
      temperature: 0.4,
      max_tokens: 8000,
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
    const aiError = err.response?.data?.error?.message || err.response?.data || err.message;
    throw new Error(`SambaNova AI Error: ${typeof aiError === 'object' ? JSON.stringify(aiError) : aiError}`);
  });

  const content = response.data.choices[0]?.message?.content;
  if (!content) throw new Error('No content returned from SambaNova API');

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Invalid response format from AI — expected JSON object');

  const newPluginData = JSON.parse(jsonMatch[0]);
  if (!newPluginData.files || !Array.isArray(newPluginData.files)) {
    throw new Error('Invalid plugin data structure — missing files array in AI response');
  }

  // Merge the new/modified files back into the original plugin data
  const mergedPluginData = { ...currentPluginData };
  if (newPluginData.pluginName) mergedPluginData.pluginName = newPluginData.pluginName;
  if (newPluginData.description) mergedPluginData.description = newPluginData.description;
  if (newPluginData.commands) mergedPluginData.commands = newPluginData.commands;
  if (newPluginData.permissions) mergedPluginData.permissions = newPluginData.permissions;

  for (const newFile of newPluginData.files) {
    const existingIdx = mergedPluginData.files.findIndex(f => 
      (f.path && newFile.path && f.path === newFile.path) || 
      (f.name && newFile.name && f.name === newFile.name)
    );
    if (existingIdx !== -1) {
      mergedPluginData.files[existingIdx] = { ...mergedPluginData.files[existingIdx], ...newFile };
    } else {
      mergedPluginData.files.push(newFile);
    }
  }

  return mergedPluginData;
}

module.exports = { generatePlugin, fixPluginErrors, updatePlugin };
