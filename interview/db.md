# Hierarchical File Systems in Relational DBs: Recursive CTEs & Constraints

This document details the relational database design patterns for representing hierarchical folder structures, querying nested file systems in a single round-trip, and managing directory naming constraints. It serves as a study guide for technical interviews, detailing database design and PostgreSQL execution plans.

---

## 1. Directory Tree Representation in Relational DBs

Modeling a file directory tree (hierarchical, unbounded depth) in a flat relational table can be accomplished through three primary design patterns. This project utilizes the **Adjacency List Model**.

### Comparative Paradigm Analysis

| Model | Database Table Schema | Insertion / Deletion Cost | Querying Whole Subtree | Depth Limit / Complexity |
| :--- | :--- | :--- | :--- | :--- |
| **Adjacency List**<br/>*(Used Here)* | Parent ID Reference:<br/>`parent_id REFERENCES files(id)` | **$O(1)$**<br/>(Simply insert or update a parent reference) | High cost without CTEs.<br/>**Low cost ($O(N)$) with Recursive CTEs** | Unbounded depth |
| **Path Enumeration**<br/>*(Materialized Path)* | String path prefix:<br/>`path = 'src/utils/math/'` | Moderate ($O(D)$)<br/>(Moving a folder requires updating all child paths) | Low cost ($O(1)$)<br/>(`WHERE path LIKE 'src/utils/math/%'`) | Limited by column string lengths |
| **Closure Table** | Auxiliary relationship table:<br/>`ancestor_id, descendant_id, path_length` | High ($O(D)$ insertions)<br/>(Requires writing paths for all ancestors) | Extremely Low ($O(1)$)<br/>(Simple join on mapping table) | Unbounded depth |

### Why Adjacency List?
For an interactive IDE workspace, file operations (renaming, moving files, deleting directories) are frequent. 
- In a **Closure Table** or **Materialized Path** model, moving a directory with 1,000 subfiles requires updating 1,000 database rows to modify their paths.
- In our **Adjacency List** model, moving a directory is a simple $O(1)$ query: we update *only* the `parent_id` of the directory itself. All children automatically remain linked underneath it. 
To bypass the traditional query performance issues of the Adjacency List model, we use **Recursive CTEs**.

---

## 2. Recursive Common Table Expressions (CTEs)

A Recursive CTE allows querying hierarchical structures by executing a query loop until no new rows are returned. It is parsed in a single round-trip database transaction.

### Anatomy of a Recursive CTE
Here is the query we execute to export a workspace as a zip archive:
```sql
WITH RECURSIVE file_path_cte AS (
  -- 1. ANCHOR MEMBER
  SELECT id, parent_id, name, type, content, name::text as path
  FROM files 
  WHERE workspace_id = $1 AND parent_id IS NULL
  
  UNION ALL
  
  -- 2. RECURSIVE MEMBER
  SELECT f.id, f.parent_id, f.name, f.type, f.content, (cte.path || '/' || f.name)::text as path
  FROM files f
  INNER JOIN file_path_cte cte ON f.parent_id = cte.id
  WHERE f.workspace_id = $1
)
-- 3. TERMINATION & FILTERING
SELECT path, type, content FROM file_path_cte WHERE type = 'file';
```

### Execution Mechanics (Step-by-Step)
PostgreSQL processes this query using an in-memory queue/stack architecture:

1.  **Anchor Execution**: The database executes the **Anchor Member** first. This finds all file nodes at the workspace root level (`parent_id IS NULL`). The result set is loaded into a working table ($R_0$) and added to the cumulative results ($C$).
2.  **Recursive Step 1**: The database executes the **Recursive Member** by joining the source `files` table against the current working table ($R_0$) on `f.parent_id = cte.id`.
    *   This locates all direct children of the root nodes (depth 1).
    *   Path strings are concatenated using the parent path: `(cte.path || '/' || f.name)`.
    *   These matching rows are populated into a new working table ($R_1$) and appended to cumulative results ($C$).
3.  **Recursive Step N**: The query repeats the join using $R_n$ as the CTE input. It continues until the join returns **zero matching rows** (representing the leaf nodes of the file system).
4.  **Final Filter**: Once the loop terminates, the database runs the outer query (`WHERE type = 'file'`) against the cumulative dataset ($C$).

---

## 3. Database Constraints: Unique Filenames under Parents

In a file system, you cannot have two files or folders with the exact same name inside the same folder. In a relational database, this is enforced using a `UNIQUE` index.

### The Null-Collision Problem in SQL
A workspace root folder is represented by having `parent_id` set to `NULL`. 
Traditionally, the SQL standard treats `NULL` as an unknown value, which means:
$$\text{NULL} \neq \text{NULL}$$

In standard unique constraints, databases do not treat separate `NULL` values as duplicate conflicts. If we defined a basic constraint:
```sql
CONSTRAINT unique_name UNIQUE (workspace_id, parent_id, name)
```
The database would allow multiple files named `index.js` at the root level (`parent_id = NULL`) because `(workspace_id, NULL, 'index.js')` does not match the other `(workspace_id, NULL, 'index.js')` index entry.

### The Solution: `UNIQUE NULLS NOT DISTINCT`
Introduced in **PostgreSQL 15**, the `NULLS NOT DISTINCT` modifier alters index comparison behavior to treat all `NULL` values as equivalent.

We define the file constraint in [schema.sql](file:///Users/amankashyap/Documents/sandbox/database/schema.sql) as:
```sql
CONSTRAINT unique_name_per_parent UNIQUE NULLS NOT DISTINCT (workspace_id, parent_id, name)
```

#### Under the Hood:
- When checking constraints during insertion:
  - If parent is a folder (`parent_id = 'uuid-123'`), standard comparison checks for duplicates.
  - If parent is root (`parent_id = NULL`), PostgreSQL treats `NULL` as a distinct comparable value, preventing the creation of two root-level files with the same name.
- This single index constraint guarantees directory integrity at the database layer without requiring slow pre-insert check transactions in application code (avoiding race conditions in high-concurrency connections).
