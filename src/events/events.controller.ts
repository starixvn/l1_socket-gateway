import { Controller, Get, Query } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { EventsGateway } from "./events.gateway";

@Controller("events")
export class EventsController {
    constructor(
        private readonly eventGateWay: EventsGateway,
        private readonly configService: ConfigService,
    ) {}

    @Get("metrics")
    getSocketMetrics(@Query("secretKey") secretKey): string {
        return secretKey === this.configService.get<string>("metrics.secretKey") ? this.eventGateWay.getSocketMetrics() : "";
    }
}
