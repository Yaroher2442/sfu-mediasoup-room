"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.server = exports.mediaLayer = void 0;
const server_1 = require("./server/server");
const Layer_1 = require("./server/Layer");
exports.mediaLayer = new Layer_1.Layer();
exports.server = new server_1.Server();
async function main() {
    // start mediasoup
    console.log('starting mediasoup');
    await exports.mediaLayer.startLayer();
    // start https server, falling back to http if https fails
    console.log('starting express');
    exports.server.setRoutes();
    await exports.server.run();
    exports.mediaLayer.setTimedTask();
    // periodically clean up peers that disconnected without sending us
    // a final "beacon"
}
main();
