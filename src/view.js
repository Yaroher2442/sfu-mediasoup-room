const mediasoup = require("mediasoup");
const config = require("./config");



mediaApp = new MediaApp();

let worker =  await mediaApp.createWorker();



let room = new Room()
await room.createRouterAndObserver()
let router = room.router
let audioLevelObserver = router.audioLevelObserver