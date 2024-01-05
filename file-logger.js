import DiscordBasePlugin from './discord-base-plugin.js';
import path from 'path';
import fs from 'fs';

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const logPath = path.join('.', 'squadjs-logs', 'squadjs.log');
const orConsoleLog = console.log;
const orConsoleError = console.error;

export default class FileLogger extends DiscordBasePlugin {
    static get description() {
        return '';
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
        this.consoleError = this.consoleError.bind(this);
        this.saveToFile = this.saveToFile.bind(this);

        console.log = this.consoleLog;
        console.error = this.consoleError;

        this.rotateLogFile();
    }

    async mount() {
        this.verbose(1, 'Mounted')
    }

    async unmount() { }

    consoleLog(...data) {
        orConsoleLog(...data);
        this.saveToFile(...data);
    }

    consoleError(...data) {
        orConsoleError(...data);
        
        data.unshift('[ERROR]')
        this.saveToFile(...data);
    }

    saveToFile(...data) {
        const stringified = data.map(p => JSON.stringify(p)?.replace(/\\u001b\[[0-9]+m/g, '')?.replace(/^"|"$/g, '')).join(' ');
        appendToFile(stringified)

        function appendToFile(content) {
            content = `[${(new Date()).toISOString()}] ${content}`
            const filePath = logPath;

            const dir = path.dirname(filePath);

            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            fs.appendFile(filePath, content + "\n", (err) => {
                if (err) throw err;
            });
        }
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

            fs.renameSync(logFile, newFile);

            const allLogFiles = fs.readdirSync(dir).filter(file => file.startsWith(`${base}_`));

            const sortedLogFiles = allLogFiles.sort((a, b) => fs.statSync(path.join(dir, b)).ctime.getTime() - fs.statSync(path.join(dir, a)).ctime.getTime());

            if (sortedLogFiles.length > maxLogFiles) {
                const filesToDelete = sortedLogFiles.slice(maxLogFiles);
                filesToDelete.forEach(file => {
                    const filePath = path.join(dir, file);
                    fs.unlinkSync(filePath);
                });
            }
        }
    }
}