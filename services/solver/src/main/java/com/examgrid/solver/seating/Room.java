package com.examgrid.solver.seating;

/** An exam room with a rows x cols seat grid. */
public record Room(String id, String block, int floor, int rows, int cols) {

    public int capacity() {
        return rows * cols;
    }

    public boolean groundFloor() {
        return floor == 0;
    }

    /**
     * Seats of one chessboard colour: (row + col) % 2 == parity. Two seats of the same
     * colour are never left/right or front/back of each other - only diagonal.
     */
    public int capacityOf(int parity) {
        int n = 0;
        for (int r = 0; r < rows; r++) {
            for (int c = 0; c < cols; c++) {
                if ((r + c) % 2 == parity) {
                    n++;
                }
            }
        }
        return n;
    }
}
