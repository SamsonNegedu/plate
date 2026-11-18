// Command genopenapi prints the OpenAPI document. It is a build tool for `make generate`, not part of the product.
package main

import (
	"fmt"
	"os"

	"plate/internal/httpapi"
)

func main() {
	b, err := httpapi.SpecJSON()
	if err != nil {
		fmt.Fprintln(os.Stderr, "genopenapi:", err)
		os.Exit(1)
	}
	if _, err := os.Stdout.Write(b); err != nil {
		fmt.Fprintln(os.Stderr, "genopenapi:", err)
		os.Exit(1)
	}
}
