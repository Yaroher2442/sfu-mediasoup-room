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
Object.defineProperty(exports, "__esModule", { value: true });
exports.server = exports.mediaLayer = void 0;
const server_1 = require("./server/server");
const Layer_1 = require("./server/Layer");
exports.mediaLayer = new Layer_1.Layer();
exports.server = new server_1.Server();
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        // start mediasoup
        console.log('starting mediasoup');
        yield exports.mediaLayer.startLayer();
        // start https server, falling back to http if https fails
        console.log('starting express');
        exports.server.setRoutes();
        yield exports.server.run();
        exports.mediaLayer.setTimedTask();
        // periodically clean up peers that disconnected without sending us
        // a final "beacon"
    });
}
main();
