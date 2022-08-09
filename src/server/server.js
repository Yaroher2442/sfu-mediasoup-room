"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Server = void 0;
const express_1 = __importDefault(require("express"));
const fs_1 = __importDefault(require("fs"));
const config_1 = require("../config");
const https_1 = __importDefault(require("https"));
const handlers_1 = require("./handlers");
class Server {
    constructor() {
        this.app = (0, express_1.default)();
        this.app.use(express_1.default.static("./src/static"));
        this.app.use(express_1.default.json({ type: '*/*' }));
    }
    run() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const tls = {
                    cert: fs_1.default.readFileSync(config_1.config.sslCrt),
                    key: fs_1.default.readFileSync(config_1.config.sslKey),
                };
                var httpsServer = https_1.default.createServer(tls, this.app);
                httpsServer.on('error', (e) => {
                    console.error('https server error,', e.message);
                });
                yield new Promise((resolve) => {
                    httpsServer.listen(config_1.config.httpPort, config_1.config.httpIp, () => {
                        console.log(`server is running and listening on ` +
                            `https://${config_1.config.httpIp}:${config_1.config.httpPort}`);
                        resolve();
                    });
                });
            }
            catch (e) {
                // @ts-ignore
                if (e.code === 'ENOENT') {
                    console.error('no certificates found (check config.js)');
                    console.error('  could not start https server ... trying http');
                }
                else {
                    console.error('could not start https server', e);
                }
                this.app.listen(config_1.config.httpPort, config_1.config.httpIp, () => {
                    console.log(`http server listening on port ${config_1.config.httpPort}`);
                });
            }
        });
    }
    setRoutes() {
        this.app.post("/signaling/sync", handlers_1.syncData);
        this.app.post("/signaling/leave", handlers_1.peerLeave);
        this.app.post("/signaling/join-as-new-peer", handlers_1.joinNewPeer);
        this.app.post('/signaling/create-transport', handlers_1.createTransport);
        this.app.post('/signaling/connect-transport', handlers_1.connectTransport);
        this.app.post('/signaling/close-transport', handlers_1.closeTransport);
        this.app.post('/signaling/close-producer', handlers_1.closeProducer);
        this.app.post('/signaling/send-track', handlers_1.sendTrack);
        this.app.post('/signaling/recv-track', handlers_1.receiveTrack);
        this.app.post('/signaling/pause-consumer', handlers_1.pauseConsumer);
        this.app.post('/signaling/resume-consumer', handlers_1.resumeConsumer);
        this.app.post('/signaling/close-consumer', handlers_1.closeConsumer);
        this.app.post('/signaling/consumer-set-layers', handlers_1.consumerSetLayers);
        this.app.post('/signaling/pause-producer', handlers_1.pauseProducer);
        this.app.post('/signaling/resume-producer', handlers_1.resumeProducer);
    }
}
exports.Server = Server;
