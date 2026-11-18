package httpapi

import "os"

// readFile reads a cached image. The path is built by the image proxy from a validated 32-hex key under the data directory.
func readFile(path string) ([]byte, error) { return os.ReadFile(path) } // #nosec G304 -- see above
