import { Pool, PoolClient } from 'pg';
import type { Block, Transaction, AddressBalance } from './types';

export class DatabaseManager {
  private pool: Pool;
  private currentHeight: number = 0;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async initialize(): Promise<void> {
    await this.createTables();
    await this.loadCurrentHeight();
  }

  getCurrentHeight(): number {
    return this.currentHeight;
  }

  async setCurrentHeight(height: number): Promise<void> {
    this.currentHeight = height;
  }

  private async loadCurrentHeight(): Promise<void> {
    const result = await this.pool.query(`
      SELECT COALESCE(MAX(height), 0) as max_height FROM blocks
    `);
    this.currentHeight = result.rows[0].max_height;
  }

  private async createTables(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS blocks (
        id TEXT PRIMARY KEY,
        height INTEGER UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        block_id TEXT REFERENCES blocks(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS transaction_inputs (
        id SERIAL PRIMARY KEY,
        transaction_id TEXT REFERENCES transactions(id),
        input_tx_id TEXT NOT NULL,
        input_index INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS transaction_outputs (
        id SERIAL PRIMARY KEY,
        transaction_id TEXT REFERENCES transactions(id),
        address TEXT NOT NULL,
        value INTEGER NOT NULL,
        output_index INTEGER NOT NULL,
        is_spent BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS address_balances (
        address TEXT PRIMARY KEY,
        balance INTEGER DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_transaction_outputs_address ON transaction_outputs(address);
    `);
    
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_transaction_outputs_tx_id_index ON transaction_outputs(transaction_id, output_index);
    `);
    
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_blocks_height ON blocks(height);
    `);
  }

  async getInputValue(txId: string, index: number): Promise<number> {
    const result = await this.pool.query(`
      SELECT value FROM transaction_outputs 
      WHERE transaction_id = $1 AND output_index = $2
    `, [txId, index]);
    
    if (result.rows.length === 0) {
      throw new Error(`Input not found: ${txId}:${index}`);
    }
    
    return result.rows[0].value;
  }

  async getAddressBalance(address: string): Promise<number> {
    const result = await this.pool.query(`
      SELECT balance FROM address_balances WHERE address = $1
    `, [address]);
    
    return result.rows.length > 0 ? parseInt(result.rows[0].balance) : 0;
  }

  async processBlock(block: Block): Promise<void> {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      await client.query(`
        INSERT INTO blocks (id, height) VALUES ($1, $2)
      `, [block.id, block.height]);
      
      for (const tx of block.transactions) {
        await this.processTransaction(client, tx, block.id);
      }
      
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async processTransaction(client: PoolClient, tx: Transaction, blockId: string): Promise<void> {
    await client.query(`
      INSERT INTO transactions (id, block_id) VALUES ($1, $2)
    `, [tx.id, blockId]);
    
    for (const input of tx.inputs) {
      await client.query(`
        INSERT INTO transaction_inputs (transaction_id, input_tx_id, input_index)
        VALUES ($1, $2, $3)
      `, [tx.id, input.txId, input.index]);
      
      await client.query(`
        UPDATE transaction_outputs 
        SET is_spent = TRUE 
        WHERE transaction_id = $1 AND output_index = $2
      `, [input.txId, input.index]);
      
      const outputResult = await client.query(`
        SELECT address, value FROM transaction_outputs 
        WHERE transaction_id = $1 AND output_index = $2
      `, [input.txId, input.index]);
      
      if (outputResult.rows.length > 0) {
        const { address, value } = outputResult.rows[0];
        
        await client.query(`
          INSERT INTO address_balances (address, balance) 
          VALUES ($1, $2)
          ON CONFLICT (address) 
          DO UPDATE SET balance = address_balances.balance - $2, updated_at = CURRENT_TIMESTAMP
        `, [address, -value]);
      }
    }
    
    for (let i = 0; i < tx.outputs.length; i++) {
      const output = tx.outputs[i];
      
      await client.query(`
        INSERT INTO transaction_outputs (transaction_id, address, value, output_index)
        VALUES ($1, $2, $3, $4)
      `, [tx.id, output.address, output.value, i]);
      
      await client.query(`
        INSERT INTO address_balances (address, balance) 
        VALUES ($1, $2)
        ON CONFLICT (address) 
        DO UPDATE SET balance = address_balances.balance + $2, updated_at = CURRENT_TIMESTAMP
      `, [output.address, output.value]);
    }
  }

  async rollbackToHeight(targetHeight: number): Promise<void> {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      const blocksResult = await client.query(`
        SELECT id, height FROM blocks WHERE height > $1 ORDER BY height DESC
      `, [targetHeight]);
      
      for (const block of blocksResult.rows) {
        await this.rollbackBlock(client, block);
      }
      
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async rollbackBlock(client: PoolClient, block: any): Promise<void> {
    const transactionsResult = await client.query(`
      SELECT id FROM transactions WHERE block_id = $1
    `, [block.id]);
    
    for (const tx of transactionsResult.rows) {
      await this.rollbackTransaction(client, tx.id);
    }
    
    await client.query(`
      DELETE FROM blocks WHERE id = $1
    `, [block.id]);
  }

  private async rollbackTransaction(client: PoolClient, txId: string): Promise<void> {
    const outputsResult = await client.query(`
      SELECT address, value FROM transaction_outputs WHERE transaction_id = $1
    `, [txId]);
    
    for (const output of outputsResult.rows) {
      await client.query(`
        UPDATE address_balances 
        SET balance = balance - $2, updated_at = CURRENT_TIMESTAMP
        WHERE address = $1
      `, [output.address, output.value]);
    }
    
    const inputsResult = await client.query(`
      SELECT input_tx_id, input_index FROM transaction_inputs WHERE transaction_id = $1
    `, [txId]);
    
    for (const input of inputsResult.rows) {
      const outputResult = await client.query(`
        SELECT address, value FROM transaction_outputs 
        WHERE transaction_id = $1 AND output_index = $2
      `, [input.input_tx_id, input.input_index]);
      
      if (outputResult.rows.length > 0) {
        const { address, value } = outputResult.rows[0];
        
        await client.query(`
          UPDATE transaction_outputs 
          SET is_spent = FALSE 
          WHERE transaction_id = $1 AND output_index = $2
        `, [input.input_tx_id, input.input_index]);
        
        await client.query(`
          UPDATE address_balances 
          SET balance = balance + $2, updated_at = CURRENT_TIMESTAMP
          WHERE address = $1
        `, [address, value]);
      }
    }
    
    await client.query(`
      DELETE FROM transaction_inputs WHERE transaction_id = $1
    `, [txId]);
    
    await client.query(`
      DELETE FROM transaction_outputs WHERE transaction_id = $1
    `, [txId]);
    
    await client.query(`
      DELETE FROM transactions WHERE id = $1
    `, [txId]);
  }
}
