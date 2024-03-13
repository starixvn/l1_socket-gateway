import { ConfigModule } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";

import { CommonModule } from "../common/common.module";
import { EventsGateway } from "./events.gateway";

let gateway: EventsGateway;
jest.useFakeTimers();
jest.spyOn(global, "setTimeout");

beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
        imports: [ConfigModule, CommonModule],
        providers: [EventsGateway],
    }).compile();

    gateway = module.get<EventsGateway>(EventsGateway);
});

afterEach(() => {
    jest.clearAllMocks();
});

describe("EventsGateway", () => {
    it("should be defined", () => {
        expect(gateway).toBeDefined();
    });

    it("handleDisconnect should remove client", () => {
        // arrange
        gateway.handleConnection({ id: "fda" });

        // act
        gateway.handleDisconnect({ id: "fda" });

        // assert
        jest.runAllTimers();
        expect(setTimeout).toHaveBeenCalled();
        expect(Object.keys(gateway.getClients()).length).toBe(0);
    });
});
