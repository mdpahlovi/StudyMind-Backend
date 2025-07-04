import { GenAIService } from '@/common/services/gen-ai.service';
import { DatabaseService } from '@/database/database.service';
import { HttpException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class HealthService {
    constructor(
        private configService: ConfigService,
        private databaseService: DatabaseService,
        private genAIService: GenAIService,
    ) {}

    getHealthStatus() {
        return {
            message: 'Healthy',
            data: {
                status: 'ok',
                timestamp: new Date().toISOString(),
                uptime: process.uptime(),
                environment: this.configService.get<string>('nodeEnv'),
                version: this.configService.get<string>('appVersion'),
            },
        };
    }

    async getDatabaseHealthStatus() {
        const isDatabaseHealthy = await this.databaseService.isHealthy();

        if (!isDatabaseHealthy) {
            throw new HttpException('Database is not healthy', 500);
        }

        return {
            message: 'Database is healthy',
            data: {
                status: 'ok',
                timestamp: new Date().toISOString(),
                uptime: process.uptime(),
                environment: this.configService.get<string>('nodeEnv'),
                version: this.configService.get<string>('appVersion'),
            },
        };
    }

    async getGenAIHealthStatus() {
        const response = await this.genAIService.generateResponse('Hello, how are you?');

        return {
            message: 'Gen AI service is healthy',
            data: {
                status: 'ok',
                timestamp: new Date().toISOString(),
                uptime: process.uptime(),
                environment: this.configService.get<string>('nodeEnv'),
                version: this.configService.get<string>('appVersion'),
                response,
            },
        };
    }
}
