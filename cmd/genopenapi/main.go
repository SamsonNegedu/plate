// Command genopenapi prints the OpenAPI document, or with -markdown the API reference built from it. It is a build
// tool for `make generate`, not part of the product.
package main

import (
	"flag"
	"fmt"
	"os"

	"plate/internal/httpapi"
)

func main() {
	markdown := flag.Bool("markdown", false, "print docs/api.md instead of the OpenAPI JSON")
	flag.Parse()

	b, err := httpapi.SpecJSON()
	if err == nil && *markdown {
		b, err = apiMarkdown(b)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "genopenapi:", err)
		os.Exit(1)
	}
	if _, err := os.Stdout.Write(b); err != nil {
		fmt.Fprintln(os.Stderr, "genopenapi:", err)
		os.Exit(1)
	}
}
