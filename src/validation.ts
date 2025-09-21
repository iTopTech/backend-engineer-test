import { createHash } from 'crypto';
import type { Block, Transaction, BlockValidationResult } from './types';
import { DatabaseManager } from './database';

export class ValidationService {
  constructor(private db: DatabaseManager) {}

  calculateBlockId(height: number, transactionIds: string[]): string {
    const combined = height + transactionIds.join('');
    return createHash('sha256').update(combined).digest('hex');
  }

  validateBlockId(block: Block): boolean {
    const transactionIds = block.transactions.map(tx => tx.id);
    const expectedId = this.calculateBlockId(block.height, transactionIds);
    return block.id === expectedId;
  }

  validateHeight(blockHeight: number, currentHeight: number): BlockValidationResult {
    if (blockHeight !== currentHeight + 1) {
      return {
        isValid: false,
        error: 'Invalid height',
        message: `Expected height ${currentHeight + 1}, got ${blockHeight}`
      };
    }
    return { isValid: true };
  }

  validateBlockIdFormat(block: Block): BlockValidationResult {
    if (!this.validateBlockId(block)) {
      return {
        isValid: false,
        error: 'Invalid block ID',
        message: 'Block ID does not match the expected hash'
      };
    }
    return { isValid: true };
  }

  async validateInputOutputBalance(transactions: Transaction[]): Promise<BlockValidationResult> {
    for (const tx of transactions) {
      if (tx.inputs.length === 0) {
        continue;
      }
      
      let inputSum = 0;
      
      for (const input of tx.inputs) {
        try {
          const value = await this.db.getInputValue(input.txId, input.index);
          inputSum += value;
        } catch (error) {
          return {
            isValid: false,
            error: 'Invalid input reference',
            message: error instanceof Error ? error.message : 'Unknown error'
          };
        }
      }
      
      const outputSum = tx.outputs.reduce((sum, output) => sum + output.value, 0);
      
      if (inputSum !== outputSum) {
        return {
          isValid: false,
          error: 'Invalid transaction balance',
          message: 'Sum of inputs does not equal sum of outputs'
        };
      }
    }
    
    return { isValid: true };
  }

  async validateBlock(block: Block): Promise<BlockValidationResult> {
    const currentHeight = this.db.getCurrentHeight();
    
    const heightValidation = this.validateHeight(block.height, currentHeight);
    if (!heightValidation.isValid) {
      return heightValidation;
    }
    
    const blockIdValidation = this.validateBlockIdFormat(block);
    if (!blockIdValidation.isValid) {
      return blockIdValidation;
    }
    
    const balanceValidation = await this.validateInputOutputBalance(block.transactions);
    if (!balanceValidation.isValid) {
      return balanceValidation;
    }
    
    return { isValid: true };
  }

  validateRollbackHeight(targetHeight: number, currentHeight: number): BlockValidationResult {
    if (isNaN(targetHeight) || targetHeight < 1) {
      return {
        isValid: false,
        error: 'Invalid height',
        message: 'Height must be a positive integer'
      };
    }
    
    if (targetHeight > currentHeight) {
      return {
        isValid: false,
        error: 'Invalid rollback height',
        message: 'Cannot rollback to a height greater than current height'
      };
    }
    
    if (currentHeight - targetHeight > 2000) {
      return {
        isValid: false,
        error: 'Rollback too far',
        message: 'Cannot rollback more than 2000 blocks'
      };
    }
    
    return { isValid: true };
  }
}
