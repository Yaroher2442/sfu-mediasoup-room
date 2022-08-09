import express, {Express} from 'express';
import fs from "fs";
import {config} from "../config";
import https from "https";

import {
    closeConsumer,
    closeProducer,
    closeTransport,
    connectTransport, consumerSetLayers,
    createTransport, joinNewPeer,
    pauseConsumer, pauseProducer, peerLeave,
    receiveTrack, resumeConsumer, resumeProducer,
    sendTrack, syncData
} from "./handlers";
import debugModule from "debug";

export class Server {
    app: Express = express();

    constructor() {
        this.app.use(express.static("./src/static"));
        this.app.use(express.json({type: '*/*'}));
    }

    async run(): Promise<void> {
        try {
            const tls = {
                cert: fs.readFileSync(config.sslCrt),
                key: fs.readFileSync(config.sslKey),
            };
            var httpsServer = https.createServer(tls, this.app);
            httpsServer.on('error', (e) => {
                console.error('https server error,', e.message);
            });
            await new Promise<void>((resolve) => {
                httpsServer.listen(config.httpPort, config.httpIp, () => {
                    console.log(`server is running and listening on ` +
                        `https://${config.httpIp}:${config.httpPort}`);
                    resolve();
                });
            });
        } catch (e) {
            // @ts-ignore
            if (e.code === 'ENOENT') {
                console.error('no certificates found (check config.js)');
                console.error('  could not start https server ... trying http');
            } else {
                console.error('could not start https server', e);
            }
            this.app.listen(config.httpPort, config.httpIp, () => {
                console.log(`http server listening on port ${config.httpPort}`);
            });
        }
    }

    setRoutes() {
        this.app.post("/signaling/sync",syncData)
        this.app.post("/signaling/leave",peerLeave)
        this.app.post("/signaling/join-as-new-peer",joinNewPeer)
        this.app.post('/signaling/create-transport', createTransport)
        this.app.post('/signaling/connect-transport', connectTransport)
        this.app.post('/signaling/close-transport', closeTransport)
        this.app.post('/signaling/close-producer', closeProducer)
        this.app.post('/signaling/send-track', sendTrack)
        this.app.post('/signaling/recv-track', receiveTrack)
        this.app.post('/signaling/pause-consumer', pauseConsumer)
        this.app.post('/signaling/resume-consumer', resumeConsumer)
        this.app.post('/signaling/close-consumer', closeConsumer)
        this.app.post('/signaling/consumer-set-layers', consumerSetLayers)
        this.app.post('/signaling/pause-producer', pauseProducer)
        this.app.post('/signaling/resume-producer', resumeProducer)

    }
}