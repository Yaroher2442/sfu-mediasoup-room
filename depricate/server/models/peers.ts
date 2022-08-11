declare module namespace {

    export interface Encoding {
        active: boolean;
        scaleResolutionDownBy: number;
        maxBitrate: number;
        rid: string;
        scalabilityMode: string;
        dtx: boolean;
    }

    export interface CamVideo {
        paused: boolean;
        encodings: Encoding[];
    }

    export interface Encoding2 {
        ssrc: number;
        dtx: boolean;
    }

    export interface CamAudio {
        paused: boolean;
        encodings: Encoding2[];
    }

    export interface Media {
        camVideo: CamVideo;
        camAudio: CamAudio;
    }

    export interface RootObject {
        id: string;
        joinTs: number;
        media: Media;
    }

}

