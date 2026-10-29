import type { QueryResultRow } from 'pg';

export interface DbQueryResult<T extends QueryResultRow = QueryResultRow> {
   rows: T[];
   rowCount: number;
}

