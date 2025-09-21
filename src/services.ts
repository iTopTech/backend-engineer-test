import { Pool } from 'pg';
import { DatabaseManager } from './database';
import { ValidationService } from './validation';
import { RouteHandler } from './routes';

export class BlockchainService {
  public db: DatabaseManager;
  public validation: ValidationService;
  public routes: RouteHandler;

  constructor(pool: Pool) {
    this.db = new DatabaseManager(pool);
    this.validation = new ValidationService(this.db);
    this.routes = new RouteHandler(this.db, this.validation);
  }

  async initialize(): Promise<void> {
    await this.db.initialize();
  }
}
