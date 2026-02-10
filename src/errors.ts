/**
 * Error classes for the clear signing library.
 */

/** Base error class for clear signing errors. */
export class ClearSigningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClearSigningError';
  }
}

/** Error during descriptor parsing or calldata decoding. */
export class DescriptorError extends ClearSigningError {
  constructor(
    public readonly kind: 'parse' | 'calldata',
    message: string
  ) {
    super(`${kind} error: ${message}`);
    this.name = 'DescriptorError';
  }

  static parse(message: string): DescriptorError {
    return new DescriptorError('parse', message);
  }

  static calldata(message: string): DescriptorError {
    return new DescriptorError('calldata', message);
  }
}

/** Error during display formatting. */
export class EngineError extends ClearSigningError {
  constructor(
    public readonly kind: 'descriptor' | 'calldata' | 'resolver' | 'internal' | 'tokenRegistry',
    message: string
  ) {
    super(`${kind} error: ${message}`);
    this.name = 'EngineError';
  }

  static descriptorParse(message: string): EngineError {
    return new EngineError('descriptor', message);
  }

  static calldata(message: string): EngineError {
    return new EngineError('calldata', message);
  }

  static resolver(message: string): EngineError {
    return new EngineError('resolver', message);
  }

  static internal(message: string): EngineError {
    return new EngineError('internal', message);
  }

  static tokenRegistry(message: string): EngineError {
    return new EngineError('tokenRegistry', message);
  }
}

/** Error during descriptor resolution. */
export class ResolverError extends ClearSigningError {
  constructor(
    public readonly kind: 'notFound' | 'invalidIndex' | 'includeNotFound' | 'parse',
    message: string
  ) {
    super(message);
    this.name = 'ResolverError';
  }

  static notFound(key: string): ResolverError {
    return new ResolverError('notFound', `descriptor not found for ${key}`);
  }

  static invalidIndex(path: string): ResolverError {
    return new ResolverError('invalidIndex', `invalid index entry for ${path}`);
  }

  static includeNotFound(name: string): ResolverError {
    return new ResolverError('includeNotFound', `include not found: ${name}`);
  }

  static parse(message: string): ResolverError {
    return new ResolverError('parse', `descriptor parse error: ${message}`);
  }
}

/** Error during EIP-712 typed data processing. */
export class Eip712Error extends ClearSigningError {
  constructor(
    public readonly kind: 'resolver' | 'descriptor' | 'typedData' | 'tokenRegistry',
    message: string
  ) {
    super(`${kind} error: ${message}`);
    this.name = 'Eip712Error';
  }

  static resolver(message: string): Eip712Error {
    return new Eip712Error('resolver', message);
  }

  static descriptorParse(message: string): Eip712Error {
    return new Eip712Error('descriptor', message);
  }

  static typedData(message: string): Eip712Error {
    return new Eip712Error('typedData', message);
  }

  static tokenRegistry(message: string): Eip712Error {
    return new Eip712Error('tokenRegistry', message);
  }
}

/** Error during token lookup. */
export class TokenLookupError extends ClearSigningError {
  constructor(
    public readonly kind: 'missingToken' | 'missingPath' | 'notAddress',
    public readonly field: string,
    message: string
  ) {
    super(message);
    this.name = 'TokenLookupError';
  }

  static missingToken(field: string): TokenLookupError {
    return new TokenLookupError(
      'missingToken',
      field,
      `display field '${field}' missing token configuration`
    );
  }

  static missingPath(path: string, field: string): TokenLookupError {
    return new TokenLookupError(
      'missingPath',
      field,
      `token path '${path}' not found for field '${field}'`
    );
  }

  static notAddress(path: string, field: string): TokenLookupError {
    return new TokenLookupError(
      'notAddress',
      field,
      `token path '${path}' is not an address for field '${field}'`
    );
  }
}
