// Command wafct turns the FAO/INFOODS West African Food Composition Table (WAFCT 2019, the Excel file from FAO) into the
// cleaned CSV the app ships as internal/food/data/wafct_2019.csv. It is a build-time tool (`make wafct`), not part of the
// running service. The source terms are in internal/food/data/NOTICE.md.
package main

import (
	"flag"
	"fmt"
	"os"
	"time"

	"plate/internal/food"
)

func main() {
	in := flag.String("in", "", "path to WAFCT_2019.xlsx (required)")
	out := flag.String("out", "internal/food/data/wafct_2019.csv", "output CSV")
	flag.Parse()
	if *in == "" {
		fmt.Fprintln(os.Stderr, "wafct: -in is required")
		os.Exit(2)
	}
	if err := run(*in, *out); err != nil {
		fmt.Fprintln(os.Stderr, "wafct:", err)
		os.Exit(1)
	}
}

func run(in, out string) error {
	foods, res, err := food.ParseWAFCT(in, time.Now(), aliases)
	if err != nil {
		return err
	}
	fh, err := os.Create(out) // #nosec G304 -- the operator's output path
	if err != nil {
		return fmt.Errorf("creating %s: %w", out, err)
	}
	if err := food.WriteReferenceCSV(fh, foods); err != nil {
		_ = fh.Close()
		return err
	}
	if err := fh.Close(); err != nil {
		return fmt.Errorf("closing %s: %w", out, err)
	}
	fmt.Printf("wafct: wrote %d foods to %s (%d skipped, %d merged)\n", len(foods), out, res.Skipped, res.Merged)
	return nil
}
