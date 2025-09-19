export interface Output {
  address: string;
  value: number;
}

export interface Input {
  txId: string;
  index: number;
}

export interface Transaction {
  id: string;
  inputs: Array<Input>;
  outputs: Array<Output>;
}

export interface Block {
  id: string;
  height: number;
  transactions: Array<Transaction>;
}

export interface AddressBalance {
  address: string;
  balance: number;
}

export interface ApiResponse<T = any> {
  message?: string;
  error?: string;
  data?: T;
}

export interface BlockValidationResult {
  isValid: boolean;
  error?: string;
  message?: string;
}
