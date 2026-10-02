import { invoke } from "@tauri-apps/api/core";

export type DevelopmentSqlValue = string | number | boolean | null;

export interface DevelopmentTransactionStatement {
  query: string;
  values?: readonly DevelopmentSqlValue[];
  expectedRowsAffected?: number;
}

interface DevelopmentTransactionStatementResult {
  rowsAffected: number;
  lastInsertId: number;
}

export async function runDevelopmentTransaction(
  statements: readonly DevelopmentTransactionStatement[],
): Promise<DevelopmentTransactionStatementResult[]> {
  if (!import.meta.env.DEV) {
    throw new Error("Development database transactions are unavailable in production.");
  }
  if (statements.length === 0) {
    return [];
  }

  return invoke<DevelopmentTransactionStatementResult[]>(
    "execute_sql_transaction",
    {
      statements: statements.map((statement) => ({
        query: statement.query,
        values: statement.values ?? [],
        expectedRowsAffected: statement.expectedRowsAffected,
      })),
    },
  );
}