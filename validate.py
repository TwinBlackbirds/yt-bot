# quick script to validate the data in a csv
import re

import csv
import sys
import re

def validate(index, row):
    url = row[1] # url should be second element from the left
    # print(url)
    if not url.startswith("http"): # not a url
        # can also occur due to parsing errors
        print(f"invalid url detected on line {index+1}: '{url}' from video '{row[0]}'")
        return False
    return True

def validate_csv():
    invalid = 0
    valid = 0
    with open(sys.argv[1]) as csvfile:
        reader = csv.reader(csvfile, delimiter='`')
        for (i, row) in enumerate(reader):
            if len(row) < 2:
                continue
            if i == 0:
                continue
            is_valid = validate(i, row)
            if is_valid:
                valid += 1
            else:
                invalid += 1
    return invalid, valid

def main():

    if len(sys.argv) != 2:
        print("Invalid usage!")
        print("Usage: python validate.py <csv>")

    (invalid, valid) = validate_csv()

    print("\n------ CSV Summary ------")
    print(f"{valid} valid urls")
    print(f"{invalid} invalid urls")
    print()
    return 0

if __name__ == '__main__':
    main()
