(module
  (import "wasi_snapshot_preview1" "proc_exec"
    (func $proc_exec (param i32 i32 i32 i32) (result i32)))
  (import "wasi_snapshot_preview1" "fd_write"
    (func $fd_write (param i32 i32 i32 i32) (result i32)))
  (memory (export "memory") 1)
  (data (i32.const 100) "FORK_OK\n")
  (func $main (export "_start")
    (drop (call $proc_exec (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0)))
    (i32.store (i32.const 0) (i32.const 100))
    (i32.store (i32.const 4) (i32.const 8))
    (drop (call $fd_write (i32.const 1) (i32.const 0) (i32.const 1) (i32.const 8)))
  )
)
