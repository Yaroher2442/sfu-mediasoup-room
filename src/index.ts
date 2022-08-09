import {Server} from "./server/server";
import {Layer} from "./server/Layer";

export const mediaLayer = new Layer();
export const server = new Server();

async function main() {
    // start mediasoup
    console.log('starting mediasoup');
    await mediaLayer.startLayer();
    // start https server, falling back to http if https fails
    console.log('starting express');
    server.setRoutes()
    await server.run();
    mediaLayer.setTimedTask();
    // periodically clean up peers that disconnected without sending us
    // a final "beacon"

}

main()