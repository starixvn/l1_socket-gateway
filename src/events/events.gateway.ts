import { UseInterceptors } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
    ConnectedSocket,
    MessageBody,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnGatewayInit,
    SubscribeMessage,
    WebSocketGateway,
    WebSocketServer,
} from "@nestjs/websockets";
import { RavenInterceptor } from "nest-raven";
import { io, ManagerOptions, Socket, SocketOptions } from "socket.io-client";
import * as prometheus from "socket.io-prom-metrics";
import { CustomLogger } from "./../common/logger.service";
import * as MsgpackParser from "socket.io-msgpack-parser";

@WebSocketGateway({
    transports: ["websocket"],
    pingInterval: 60 * 1000,
    pingTimeout: 60 * 1000,
    allowUpgrades: false,
    allowEIO3: true,
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit {
    private readonly FailedConnectionErrorCode = "SB0010";
    private clients = {};
    private socketIOMetrics: prometheus.SocketIOMetrics;
    private enabledMsgpack: boolean;

    @WebSocketServer()
    server: any;

    constructor(
        private readonly configService: ConfigService,
        private readonly logService: CustomLogger,
    ) {}

    afterInit(server: any) {
        this.socketIOMetrics = prometheus.metrics(server, {
            collectDefaultMetrics: true,
            checkForNewNamespaces: false,
        });

        this.enabledMsgpack = this.configService.get<boolean>("enabledMsgPack");
    }

    getSocketMetrics(): string {
        return this.socketIOMetrics.register.metrics();
    }

    handleConnection(client: any) {
        this.clients[client.id] = {};
    }

    handleDisconnect(client: any) {
        if (!this.clients[client.id]) {
            return;
        }

        const sockets = this.clients[client.id];

        Object.values(sockets).forEach((socket: any) => {
            if (socket) {
                socket.disconnect();
                socket.close();
            }
        });

        setTimeout(() => {
            delete this.clients[client.id];
        });
    }

    @UseInterceptors(new RavenInterceptor())
    @SubscribeMessage("signIn")
    signIn(@MessageBody() data: any, @ConnectedSocket() client: any) {
        if (!data?.gameName) {
            return;
        }

        const socket = this.connectSocket(client, data.gameName, data.session, data.serviceName);

        if (socket) {
            socket.on("signedIn", () => {
                if (this.clients[client.id]) {
                    this.setGameSocket(client.id, data.gameName, socket);
                    client.emit(data.gameName, { signedIn: true });
                }
            });
        } else {
            client.emit(data.gameName, { errorCode: this.FailedConnectionErrorCode });
            this.logService.log("Cannot open socket", [data.gameName, data.session.username]);
        }
    }

    @UseInterceptors(new RavenInterceptor())
    @SubscribeMessage("getLobbyData")
    getLobbyData(@MessageBody() data: any, @ConnectedSocket() client: any) {
        if (!data?.gameName) {
            return;
        }

        const socket = this.getGameSocket(client.id, data.gameName);

        if (socket?.connected) {
            socket.emit("getLobbyData");
        }
    }

    @UseInterceptors(new RavenInterceptor())
    @SubscribeMessage("inGame")
    inGame(@MessageBody() gameName: string, @ConnectedSocket() client: any) {
        if (!gameName) {
            return;
        }

        const socket = this.getGameSocket(client.id, gameName);

        if (socket?.connected) {
            socket.emit("inGame");
        }
    }

    @UseInterceptors(new RavenInterceptor())
    @SubscribeMessage("bet")
    placingBet(@MessageBody() data: any, @ConnectedSocket() client: any) {
        if (!data?.gameName) {
            return;
        }

        const socket = this.getGameSocket(client.id, data.gameName);

        if (socket?.connected) {
            socket.emit("bet", data.betData);
        }
    }

    @UseInterceptors(new RavenInterceptor())
    @SubscribeMessage("outGame")
    outGame(@MessageBody() gameName: string, @ConnectedSocket() client: any) {
        if (!gameName) {
            return;
        }

        const socket = this.getGameSocket(client.id, gameName);

        if (socket?.connected) {
            socket.disconnect();
            this.setGameSocket(client.id, gameName, null);
        }
    }

    private convertToServiceNameUri(gameName: string, serviceName?: string) {
        const separateChar = this.configService.get<string>("separateChar");
        if (serviceName) {
            return serviceName.replace(/-|_/g, separateChar);
        }
        const name = gameName.charAt(0).toLowerCase() + gameName.slice(1);
        return name.replace(/[A-Z]|\d+|[A-Z](?=\d)/g, (match) => separateChar + match.toLowerCase());
    }

    private setupGameSocket(client: any, gameName: string, serviceName?: string) {
        const socketUri = this.formatServiceUri(this.convertToServiceNameUri(gameName, serviceName), gameName);
        if (socketUri === undefined) {
            return null;
        }

        const options: Partial<ManagerOptions & SocketOptions> = {
            forceNew: true,
            transports: ["websocket"],
            upgrade: false,
            extraHeaders: {
                "user-agent": client.request.headers["user-agent"],
                origin: client.request.headers["origin"],
            },
        };

        if (this.enabledMsgpack) {
            options.parser = MsgpackParser;
        }

        return io(socketUri, options);
    }

    private connectSocket(client: any, gameName: string, session: any, serviceName?: string): Socket {
        const gameSocket = this.setupGameSocket(client, gameName, serviceName);

        if (gameSocket) {
            gameSocket.on("connect", () => {
                try {
                    gameSocket.emit("signin", session);
                } catch (ex) {
                    this.logService.error(ex);
                }
            });

            gameSocket.on(gameName, (data: any) => {
                try {
                    client.emit(gameName, data);
                } catch (ex) {
                    this.logService.error(ex);
                }
            });

            gameSocket.on("message", (data: any) => {
                try {
                    client.emit("message", data);
                } catch (ex) {
                    this.logService.error(ex);
                }
            });

            gameSocket.on("connect_error", (error: any) => {
                try {
                    this.logService.error(error);
                    gameSocket.close();
                    client.emit(gameName, { errorCode: this.FailedConnectionErrorCode });
                } catch (ex) {
                    this.logService.error(ex);
                }
            });

            gameSocket.on("disconnect", () => {
                try {
                    client.emit(gameName, { errorCode: this.FailedConnectionErrorCode });
                } catch (ex) {
                    this.logService.error(ex);
                }
            });
        }

        return gameSocket;
    }

    private getGameSocket(clientId: string, gameName: string) {
        return this.clients[clientId]?.[gameName.trim().toLowerCase()];
    }

    private setGameSocket(clientId: string, gameName: string, socket: Socket) {
        if (this.clients[clientId]) {
            this.clients[clientId][gameName.trim().toLowerCase()] = socket;
        }
    }

    public getClients() {
        return this.clients;
    }

    private formatServiceUri(serviceName: string, gameName: string): string {
        const serviceNamePattern = this.configService.get<string>("serviceNamePattern");

        return `${serviceNamePattern.replace("{0}", serviceName)}/user/${gameName.toLowerCase()}`;
    }
}
