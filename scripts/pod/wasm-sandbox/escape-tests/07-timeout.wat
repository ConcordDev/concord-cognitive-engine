(module
  (func $main (export "_start")
    (loop $forever (br $forever))
  )
)
