const { exec } = require('child_process');
const path = require('path');
const fs = require('fs-extra');
const os = require('os');
const { fixPluginErrors } = require('../controllers/pluginController');

const MAX_FIX_RETRIES = 3;

/**
 * Generate a Maven pom.xml for compiling a Bukkit plugin
 */
function generatePomXml(pluginData, version) {
  const artifactId = (pluginData.pluginName || 'myplugin').toLowerCase().replace(/[^a-z0-9-]/g, '-');
  
  // Determine Java version based on Minecraft version
  // 1.20.5+ requires Java 21. 1.17 to 1.20.4 requires 17.
  let javaVersion = '17';
  if (version.startsWith('1.21')) { // 1.21, 1.21.1, 1.21.11, etc.
    javaVersion = '21';
  }

  // Determine Paper API version string
  // For '1.21.11' the closest public available might just be 1.21.1, but Maven might try to resolve exactly what we give it.
  // We'll append -R0.1-SNAPSHOT to whatever they supply.
  let paperVersion = `${version}-R0.1-SNAPSHOT`;
  if (version === '1.21.11') {
    // There is officially no 1.21.11, it's a typo/niche fork, use 1.21.1
    paperVersion = '1.21.1-R0.1-SNAPSHOT';
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>

    <groupId>com.pluginforge</groupId>
    <artifactId>${artifactId}</artifactId>
    <version>${pluginData.version || '1.0.0'}</version>
    <packaging>jar</packaging>

    <name>${pluginData.pluginName || 'MyPlugin'}</name>

    <properties>
        <maven.compiler.source>${javaVersion}</maven.compiler.source>
        <maven.compiler.target>${javaVersion}</maven.compiler.target>
        <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
    </properties>

    <repositories>
        <repository>
            <id>papermc</id>
            <url>https://repo.papermc.io/repository/maven-public/</url>
        </repository>
        <repository>
            <id>spigot-repo</id>
            <url>https://hub.spigotmc.org/nexus/content/repositories/snapshots/</url>
        </repository>
    </repositories>

    <dependencies>
        <dependency>
            <groupId>io.papermc.paper</groupId>
            <artifactId>paper-api</artifactId>
            <version>${paperVersion}</version>
            <scope>provided</scope>
        </dependency>
    </dependencies>

    <build>
        <plugins>
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-shade-plugin</artifactId>
                <version>3.5.1</version>
                <executions>
                    <execution>
                        <phase>package</phase>
                        <goals>
                            <goal>shade</goal>
                        </goals>
                        <configuration>
                            <createDependencyReducedPom>false</createDependencyReducedPom>
                        </configuration>
                    </execution>
                </executions>
            </plugin>
        </plugins>
    </build>
</project>`;
}

/**
 * Generate a build.gradle file
 */
function generateBuildGradle(pluginData, version) {
  let javaVersion = '17';
  if (version.startsWith('1.21')) javaVersion = '21';
  let paperVersion = `${version}-R0.1-SNAPSHOT`;
  if (version === '1.21.11') paperVersion = '1.21.1-R0.1-SNAPSHOT';

  return `plugins {
    id 'java'
}

group = 'com.pluginforge'
version = '${pluginData.version || '1.0.0'}'

repositories {
    mavenCentral()
    maven {
        name = "papermc-repo"
        url = "https://repo.papermc.io/repository/maven-public/"
    }
    maven {
        name = "sonatype"
        url = "https://oss.sonatype.org/content/groups/public/"
    }
}

dependencies {
    compileOnly "io.papermc.paper:paper-api:${paperVersion}"
}

def targetJavaVersion = ${javaVersion}
java {
    def javaVersion = JavaVersion.toVersion(targetJavaVersion)
    sourceCompatibility = javaVersion
    targetCompatibility = javaVersion
}

tasks.withType(JavaCompile).configureEach {
    options.encoding = 'UTF-8'
}
`;
}

function generateSettingsGradle(pluginData) {
  const artifactId = (pluginData.pluginName || 'myplugin').toLowerCase().replace(/[^a-z0-9-]/g, '-');
  return `rootProject.name = '${artifactId}'\n`;
}

/**
 * Write plugin files to a temp directory
 */
async function writeFilesToTemp(pluginData, tempDir, version, buildSystem) {
  for (const file of pluginData.files) {
    if (!file.path || !file.content) continue;
    const filePath = path.join(tempDir, file.path);
    await fs.ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, file.content, 'utf8');
  }
  
  if (buildSystem === 'Gradle') {
    await fs.writeFile(path.join(tempDir, 'build.gradle'), generateBuildGradle(pluginData, version), 'utf8');
    await fs.writeFile(path.join(tempDir, 'settings.gradle'), generateSettingsGradle(pluginData), 'utf8');
  } else {
    await fs.writeFile(path.join(tempDir, 'pom.xml'), generatePomXml(pluginData, version), 'utf8');
  }
}

/**
 * Run Maven package command
 */
function runMaven(tempDir) {
  return new Promise((resolve, reject) => {
    const mvnCmd = process.platform === 'win32' ? 'mvn.cmd' : 'mvn';
    // Use multi-threading to speed up maven
    exec(`${mvnCmd} package -q -T 1C`, { cwd: tempDir, timeout: 120000 }, (error, stdout, stderr) => {
      if (error) {
        reject({ error: error.message, stdout, stderr });
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

/**
 * Run Gradle build command
 */
function runGradle(tempDir) {
  return new Promise((resolve, reject) => {
    const gradleCmd = process.platform === 'win32' ? 'gradle.bat' : 'gradle';
    // Use parallel and build cache to speed up
    exec(`${gradleCmd} build -q --parallel --build-cache`, { cwd: tempDir, timeout: 120000 }, (error, stdout, stderr) => {
      if (error) {
        reject({ error: error.message, stdout, stderr });
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

/**
 * Find compiled JAR in target/ or build/libs/
 */
async function findJar(tempDir, buildSystem) {
  const targetDir = buildSystem === 'Gradle' ? path.join(tempDir, 'build', 'libs') : path.join(tempDir, 'target');
  if (!await fs.pathExists(targetDir)) return null;
  
  const files = await fs.readdir(targetDir);
  const jar = files.find(f => f.endsWith('.jar') && !f.includes('original'));
  return jar ? path.join(targetDir, jar) : null;
}

/**
 * Main compile function with auto-fix retry loop
 */
async function compilePlugin(pluginData, version, buildSystem, onProgress) {
  const tempDir = path.join(os.tmpdir(), `pluginforge_${Date.now()}`);
  await fs.ensureDir(tempDir);

  let currentPluginData = { ...pluginData };
  
  try {
    for (let attempt = 1; attempt <= MAX_FIX_RETRIES; attempt++) {
      onProgress({ stage: 'writing', attempt, message: `Writing files (attempt ${attempt}/${MAX_FIX_RETRIES})...` });
      await writeFilesToTemp(currentPluginData, tempDir, version, buildSystem);

      onProgress({ stage: 'compiling', attempt, message: `Compiling with ${buildSystem} (attempt ${attempt}/${MAX_FIX_RETRIES})...` });

      try {
        if (buildSystem === 'Gradle') {
          await runGradle(tempDir);
        } else {
          await runMaven(tempDir);
        }
        
        const jarPath = await findJar(tempDir, buildSystem);
        
        if (!jarPath) throw new Error(`${buildSystem} succeeded but no JAR found in output directory`);

        onProgress({ stage: 'success', attempt, message: 'Compilation successful! ✅' });
        return { success: true, jarPath, tempDir, fixedData: currentPluginData };
        
      } catch (compileErr) {
        const errors = `${compileErr.stderr || ''}\n${compileErr.stdout || ''}\n${compileErr.error || ''}`.trim();
        
        if (attempt < MAX_FIX_RETRIES) {
          onProgress({ 
            stage: 'fixing', 
            attempt, 
            message: `Compilation failed. Auto-fixing errors (attempt ${attempt}/${MAX_FIX_RETRIES})...`,
            errors 
          });
          currentPluginData = await fixPluginErrors(currentPluginData, errors);
          // Clean temp dir for retry
          await fs.emptyDir(tempDir);
        } else {
          throw new Error(`Compilation failed after ${MAX_FIX_RETRIES} attempts:\n${errors}`);
        }
      }
    }
  } catch (err) {
    await fs.remove(tempDir).catch(() => {});
    throw err;
  }
}

module.exports = { compilePlugin, generatePomXml, generateBuildGradle, generateSettingsGradle };
