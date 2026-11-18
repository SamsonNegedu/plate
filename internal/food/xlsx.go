package food

import (
	"archive/zip"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"
)

const (
	maxXLSXSheetBytes  = 400 << 20
	maxXLSXStringBytes = 100 << 20
)

// xlsxRows streams the first worksheet of an .xlsx file as rows of strings, indexed by column (A=0). It reads only what
// the standard library gives us: the archive, the shared strings and one sheet. Unknown or hostile structure fails closed.
func xlsxRows(path string, each func(row []string) error) error {
	zr, err := zip.OpenReader(path)
	if err != nil {
		return fmt.Errorf("opening xlsx: %w", err)
	}
	defer func() { _ = zr.Close() }()
	files := map[string]*zip.File{}
	for _, f := range zr.File {
		files[f.Name] = f
	}
	sheet, ok := files["xl/worksheets/sheet1.xml"]
	if !ok {
		return errors.New("xlsx has no first worksheet")
	}
	var shared []string
	if f, ok := files["xl/sharedStrings.xml"]; ok {
		shared, err = readSharedStrings(f)
		if err != nil {
			return err
		}
	}
	rc, err := sheet.Open()
	if err != nil {
		return fmt.Errorf("opening worksheet: %w", err)
	}
	defer func() { _ = rc.Close() }()
	return streamSheet(io.LimitReader(rc, maxXLSXSheetBytes), shared, each)
}

func readSharedStrings(f *zip.File) ([]string, error) {
	rc, err := f.Open()
	if err != nil {
		return nil, fmt.Errorf("opening shared strings: %w", err)
	}
	defer func() { _ = rc.Close() }()
	dec := xml.NewDecoder(io.LimitReader(rc, maxXLSXStringBytes))
	var out []string
	var cur strings.Builder
	inSI, inT := false, false
	for {
		tok, err := dec.Token()
		if errors.Is(err, io.EOF) {
			return out, nil
		}
		if err != nil {
			return nil, fmt.Errorf("reading shared strings: %w", err)
		}
		switch t := tok.(type) {
		case xml.StartElement:
			switch t.Name.Local {
			case "si":
				inSI = true
				cur.Reset()
			case "t":
				inT = inSI
			}
		case xml.CharData:
			if inT {
				cur.Write(t)
			}
		case xml.EndElement:
			switch t.Name.Local {
			case "t":
				inT = false
			case "si":
				out = append(out, cur.String())
				inSI = false
			}
		}
	}
}

func streamSheet(r io.Reader, shared []string, each func([]string) error) error {
	dec := xml.NewDecoder(r)
	var row []string
	var col int
	var cellType string
	var text strings.Builder
	inV, inIS, inCell := false, false, false
	for {
		tok, err := dec.Token()
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("reading worksheet: %w", err)
		}
		switch t := tok.(type) {
		case xml.StartElement:
			switch t.Name.Local {
			case "row":
				row = row[:0]
			case "c":
				inCell = true
				cellType = ""
				text.Reset()
				col = len(row)
				for _, a := range t.Attr {
					switch a.Name.Local {
					case "t":
						cellType = a.Value
					case "r":
						col = columnIndex(a.Value)
					}
				}
			case "v":
				inV = inCell
			case "is":
				inIS = inCell
			}
		case xml.CharData:
			if inV || inIS {
				text.Write(t)
			}
		case xml.EndElement:
			switch t.Name.Local {
			case "v":
				inV = false
			case "is":
				inIS = false
			case "c":
				val := text.String()
				if cellType == "s" {
					i, err := strconv.Atoi(strings.TrimSpace(val))
					if err != nil || i < 0 || i >= len(shared) {
						val = ""
					} else {
						val = shared[i]
					}
				}
				if col >= 0 && col < 5000 {
					for len(row) <= col {
						row = append(row, "")
					}
					row[col] = val
				}
				inCell = false
			case "row":
				if err := each(row); err != nil {
					return err
				}
			}
		}
	}
}

// columnIndex converts a cell reference such as "AB12" to a zero-based column.
func columnIndex(ref string) int {
	n := 0
	for _, r := range ref {
		if r < 'A' || r > 'Z' {
			break
		}
		n = n*26 + int(r-'A') + 1
	}
	return n - 1
}
