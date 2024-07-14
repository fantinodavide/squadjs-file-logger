import DiscordBasePlugin from './discord-base-plugin.js';
import { MessageAttachment } from "discord.js";
import path from 'path';
import fs from 'fs';
import { inspect } from 'node:util';
import { createGzip } from 'zlib';

const logPath = path.join('.', 'squadjs-logs', 'squadjs.log');
const orConsoleLog = console.log;

export default class FileLogger extends DiscordBasePlugin {
    static get description() {
        return 'File logger with Discord integration';
    }

    static get defaultEnabled() {
        return true;
    }

    static get optionsSpecification() {
        return {
            ...DiscordBasePlugin.optionsSpecification,
            channelID: {
                required: true,
                description: 'The ID of the channel to send log messages to.',
                default: '',
                example: '667741905228136459'
            }
        };
    }

    constructor(server, options, connectors) {
        super(server, options, connectors);

        this.consoleLog = this.consoleLog.bind(this);
        this.onUncaughtException = this.onUncaughtException.bind(this);
        this.saveToFile = this.saveToFile.bind(this);
        this.sendLogToDiscord = this.sendLogToDiscord.bind(this);
        this.gzipFile = this.gzipFile.bind(this);
        this.discordMessage = this.discordMessage.bind(this);

        console.log = this.consoleLog;

        process.on('uncaughtException', this.onUncaughtException);

        this.logQueue = [];
        this.isDiscordReady = false;
    }

    async mount() {
        this.verbose(1, 'FileLogger Mounted');
        this.isDiscordReady = true;
        this.processLogQueue();
        this.rotateLogFile();
    }

    async unmount() { }

    consoleLog(...data) {
        orConsoleLog(...data);
        this.saveToFile(...data);
    }

    onUncaughtException(...data) {
        data.unshift('[ERROR]');
        this.saveToFile(...data);
    }

    saveToFile(...data) {
        const stringified = data.map(p => inspect((typeof p === 'string' ? p.replace(ansiRegex(), '') : p), { compact: true, breakLength: Infinity, colors: false, depth: 4 }).replace(/(^"|')|("|'$)/g, '')).join(' ');
        this.appendToFile(stringified);
    }

    appendToFile(content) {
        content = `[${(new Date()).toISOString()}] ${content}`;
        const filePath = logPath;

        const dir = path.dirname(filePath);

        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        fs.appendFile(filePath, content + "\n", (err) => {
            if (err) throw err;
        });
    }

    rotateLogFile() {
        const logFile = logPath;
        const maxLogFiles = 10;

        if (fs.existsSync(logFile)) {
            const ext = path.extname(logFile);
            const base = path.basename(logFile, ext);
            const dir = path.dirname(logFile);
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const newFile = path.join(dir, `${base}_${timestamp}${ext}`);

            // Rename the current log file
            fs.renameSync(logFile, newFile);

            // Get all log files (including the newly renamed one)
            const allLogFiles = fs.readdirSync(dir).filter(file =>
                file.startsWith(`${base}_`) || file === `${base}${ext}`
            );

            // Sort log files by creation time (oldest first)
            const sortedLogFiles = allLogFiles.sort((a, b) =>
                fs.statSync(path.join(dir, a)).ctime.getTime() -
                fs.statSync(path.join(dir, b)).ctime.getTime()
            );

            // If we have more than maxLogFiles, delete the oldest ones
            while (sortedLogFiles.length > maxLogFiles) {
                const oldestFile = sortedLogFiles.shift(); // Remove and get the oldest file
                const filePath = path.join(dir, oldestFile);
                fs.unlinkSync(filePath);
            }

            // Send the rotated log file to Discord
            this.sendLogToDiscord(newFile).catch(error => {
                this.verbose(1, `Error sending log to Discord: ${error.message}`);
            });
        }
    }

    async sendLogToDiscord(logFilePath) {
        if (!logFilePath || typeof logFilePath !== 'string') {
            throw new Error(`Invalid logFilePath: ${logFilePath}`);
        }

        this.verbose(1, `Attempting to send log file: ${logFilePath}`);

        if (!fs.existsSync(logFilePath)) {
            throw new Error(`Log file does not exist: ${logFilePath}`);
        }

        const gzFileName = path.basename(logFilePath) + '.gz';
        const logFileSize = fs.statSync(logFilePath).size / 1024 / 1024;
        this.verbose(1, 'Log file rotated:', logFilePath, logFileSize);

        try {
            const buffer = await this.gzipFile(logFilePath);
            await this.discordMessage(gzFileName, buffer);
        } catch (error) {
            this.verbose(1, `Error processing log file: ${error.message}`);
            throw error;
        }
    }

    async gzipFile(filePath) {
        return new Promise((resolve, reject) => {
            if (!fs.existsSync(filePath)) {
                reject(new Error(`File does not exist: ${filePath}`));
                return;
            }

            const source = fs.createReadStream(filePath);
            const gzip = createGzip();
            const chunks = [];

            gzip.on('data', (chunk) => chunks.push(chunk));
            gzip.on('end', () => resolve(Buffer.concat(chunks)));
            gzip.on('error', (error) => reject(error));

            source.on('error', (error) => reject(error));

            source.pipe(gzip);
        });
    }

    async discordMessage(fileName, buffer) {
        if (!this.isDiscordReady) {
            this.verbose(1, 'Discord not ready. Queuing message.');
            this.logQueue.push({ fileName, buffer });
            return;
        }

        try {
            await this.sendDiscordMessage({
                embed: {
                    title: `Log file rotated`,
                    color: 0x00FF00,
                    timestamp: (new Date()).toISOString(),
                    footer: {
                        text: `${this.server.serverName}`
                    }
                }
            });
            await this.sendDiscordMessage({
                files: [
                    new MessageAttachment(buffer, fileName)
                ]
            });
        } catch (error) {
            this.verbose(1, `Error sending Discord message: ${error.message}`);
            throw error;
        }
    }

    async processLogQueue() {
        while (this.logQueue.length > 0) {
            const { fileName, buffer } = this.logQueue.shift();
            try {
                await this.discordMessage(fileName, buffer);
            } catch (error) {
                this.verbose(1, `Error processing queued log: ${error.message}`);
            }
        }
    }

    createCircularReplacer() {
        const seenObjects = new Map();

        return function replacer(key, value) {
            const path = seenObjects.get(this) || "";
            const newPath = path ? path + "." + key : key;

            if (typeof value === "object" && value !== null) {
                if (seenObjects.has(value)) {
                    // Check if the current path starts with the path of the first occurrence of the object
                    // This indicates a circular reference
                    if (newPath.startsWith(seenObjects.get(value))) {
                        return "[Circular]";
                    }
                } else {
                    // Store the path to the current object for potential future circular reference checks
                    seenObjects.set(value, newPath);
                }
            }

            return value;
        };
    }
}

function ansiRegex({ onlyFirst = false } = {}) {
    const pattern = [
        '[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)',
        '(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~]))'
    ].join('|');

    return new RegExp(pattern, onlyFirst ? undefined : 'g');
}
