import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Block, AddressBalance, ApiResponse } from './types';
import { DatabaseManager } from './database';
import { ValidationService } from './validation';

export class RouteHandler {
  constructor(
    private db: DatabaseManager,
    private validation: ValidationService
  ) {}

  async registerRoutes(fastify: FastifyInstance): Promise<void> {
    fastify.post('/blocks', async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const block = request.body as Block;

        const validationResult = await this.validation.validateBlock(block);
        if (!validationResult.isValid) {
          return reply.status(400).send({
            error: validationResult.error,
            message: validationResult.message
          });
        }

        await this.db.processBlock(block);
        await this.db.setCurrentHeight(block.height);

        return reply.status(200).send({ message: 'Block processed successfully' });
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Internal server error' });
      }
    });

    fastify.get('/balance/:address', async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { address } = request.params as { address: string };
        
        const balance = await this.db.getAddressBalance(address);
        
        return reply.status(200).send({ address, balance });
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Internal server error' });
      }
    });

    fastify.post('/rollback', async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { height } = request.query as { height: string };
        const targetHeight = parseInt(height);
        const currentHeight = this.db.getCurrentHeight();
        
        const validationResult = this.validation.validateRollbackHeight(targetHeight, currentHeight);
        if (!validationResult.isValid) {
          return reply.status(400).send({
            error: validationResult.error,
            message: validationResult.message
          });
        }
        
        await this.db.rollbackToHeight(targetHeight);
        await this.db.setCurrentHeight(targetHeight);
        
        return reply.status(200).send({ 
          message: `Successfully rolled back to height ${targetHeight}`,
          currentHeight: targetHeight
        });
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Internal server error' });
      }
    });
  }
}