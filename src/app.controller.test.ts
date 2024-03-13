import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import * as request from "supertest";

import { AppModule } from "./app.module";

describe("AppController (e2e)", () => {
    let app: NestFastifyApplication;

    beforeAll(async () => {
        const moduleFixture = await Test.createTestingModule({
            imports: [AppModule],
        }).compile();

        app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
        await app.init();
        await app.getHttpAdapter().getInstance().ready();
    });

    it("/ (GET)", () => {
        return request.agent(app.getHttpServer()).get("/").expect(200).expect("Hello, I am socket gateway");
    });

    it("/health (GET)", () => {
        return request.agent(app.getHttpServer()).get("/health").expect(200).expect("Socket gateway is OK");
    });
});
