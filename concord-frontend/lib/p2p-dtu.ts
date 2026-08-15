import { RTCPeerConnection, RTCIceCandidate, DataChannel } from 'wrtc';

interface P2PDTUOptions {
    iceServers?: RTCIceServer[];
}

export class P2PDTU {
    private peerConnection: RTCPeerConnection;
    private dataChannel: DataChannel | null = null;
    private offerId: string | null = null;

    constructor(private dtuHash: string, private options: P2PDTUOptions = {}) {
        this.peerConnection = new RTCPeerConnection({
            iceServers: options.iceServers || [
                { urls: 'stun:stun.l.google.com:19302' }
            ]
        });

        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.handleICECandidate(event.candidate);
            }
        };

        this.peerConnection.ondatachannel = (event) => {
            this.dataChannel = event.channel;
            this.dataChannel.onmessage = (event) => {
                this.onDataChannelMessage(event.data);
            };
        };
    }

    async createOffer(): Promise<string> {
        const offer = await this.peerConnection.createOffer();
        await this.peerConnection.setLocalDescription(offer);
        
        const response = await fetch('/api/p2p/dtu/offer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dtuHash: this.dtuHash })
        });

        const { offerId } = await response.json();
        this.offerId = offerId;
        return offerId;
    }

    async joinOffer(offerId: string): Promise<void> {
        this.offerId = offerId;
        
        const response = await fetch(`/api/p2p/dtu/poll/${offerId}`, {
            method: 'GET'
        });

        const { answer } = await response.json();
        if (answer) {
            await this.peerConnection.setRemoteDescription(answer);
        }
    }

    private handleICECandidate(candidate: RTCIceCandidate) {
        if (this.offerId) {
            fetch('/api/p2p/dtu/answer/' + this.offerId, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ candidate })
            });
        }
    }

    protected onDataChannelMessage(message: string): void {
        // Override this method to handle incoming DTU messages
    }
}
