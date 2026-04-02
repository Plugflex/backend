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

async function updatePluginSSE(currentPluginData, prompt, version, sendEvent) {
  const apiKey = process.env.SAMBANOVA_API_KEY;
  if (!apiKey || apiKey === 'your_sambanova_api_key_here') {
    throw new Error('SambaNova API key not configured.');
  }

  // Step 1: Execution Planner
  sendEvent({ type: 'progress', message: `🔍 Analyzing request to create execution plan...` });
  
  const planPrompt = `You are updating a Minecraft plugin. The user wants the following modifications:
"${prompt}"

CURRENT PLUGIN JSON:
${JSON.stringify(currentPluginData, null, 2)}

Which files need to be modified or created to fulfill this instruction? 
Return ONLY a JSON array of file paths as strings. Maximum 3 files. Do not return code, only the array of strings. 
Example response: ["src/main/java/com/example/Main.java", "src/main/resources/config.yml"]`;

  const planResponse = await axios.post(
    SAMBANOVA_URL,
    {
      model: MODEL,
      messages: [{ role: 'system', content: "Respond ONLY with a JSON array." }, { role: 'user', content: planPrompt }],
      temperature: 0.1,
      max_tokens: 1000,
      stream: false
    },
    { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' } }
  ).catch(err => { throw new Error(`Planner AI Error: ${err.message}`); });

  const planContent = planResponse.data.choices[0]?.message?.content;
  const arrayMatch = planContent.match(/\[[\s\S]*\]/);
  if (!arrayMatch) throw new Error('AI Planner failed to return an array of file paths.');
  
  let filesToEdit = [];
  try {
    filesToEdit = JSON.parse(arrayMatch[0]);
  } catch(e) {
    throw new Error('AI Planner returned invalid JSON array.');
  }

  if (filesToEdit.length === 0) {
    sendEvent({ type: 'progress', message: `No files needed modifying.` });
    return currentPluginData;
  }

  sendEvent({ type: 'progress', message: `📝 Planner intends to edit ${filesToEdit.length} files.` });

  // Step 2: Extracting Files
  const mergedPluginData = { ...currentPluginData };

  for (const filePath of filesToEdit) {
    sendEvent({ type: 'progress', message: `✨ Coding ${filePath}...` });
    
    // Find if the file already exists to give the AI context if needed
    const existingFile = mergedPluginData.files.find(f => f.path === filePath || f.name === filePath.split('/').pop());
    
    const filePrompt = `Update or create the file "${filePath}" to fulfill the user's request: "${prompt}".
${existingFile ? `Existing file content:\n\`\`\`\n${existingFile.content}\n\`\`\`` : 'This is a new file.'}

CRITICAL RULES:
1. ONLY return a JSON object with a "files" array containing EXACTLY this ONE file.
2. EXPAND ALL PLACEHOLDERS: If the Existing file content contains any placeholders or "TODO" comments (e.g. "// Handle logic here", "// Initialize plugin"), YOU MUST REPLACE THEM with the actual fully working code! NEVER output placeholders. Write the entire file completely from top to bottom.
3. Keep the exact same JSON format as previously defined.`;

    const fileResponse = await axios.post(
      SAMBANOVA_URL,
      {
        model: MODEL,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: filePrompt }],
        temperature: 0.2,
        max_tokens: 8000,
        stream: false
      },
      { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' } }
    ).catch(err => { throw new Error(`File Coder AI Error: ${err.message}`); });

    const fileContent = fileResponse.data.choices[0]?.message?.content;
    const jsonMatch = fileContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
       sendEvent({ type: 'progress', message: `⚠️ Failed to structure ${filePath}, skipping.` });
       continue;
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.files && parsed.files.length > 0) {
        const newFile = parsed.files[0];
        const existingIdx = mergedPluginData.files.findIndex(f => f.path === newFile.path || f.name === newFile.name);
        if (existingIdx !== -1) {
          mergedPluginData.files[existingIdx] = { ...mergedPluginData.files[existingIdx], ...newFile };
        } else {
          mergedPluginData.files.push(newFile);
        }
        sendEvent({ type: 'file_updated', filePath: newFile.path || newFile.name });
      }
    } catch(e) {
      sendEvent({ type: 'progress', message: `⚠️ Corrupt generation for ${filePath}.` });
    }
  }

  return mergedPluginData;
}

module.exports = { generatePlugin, fixPluginErrors, updatePluginSSE };
