package com.examgrid.solver.seating;

/** One chessboard colour of a room: the value a {@link SeatBlock} is assigned to. */
public class RoomHalf {

    private String id;
    private Room room;
    private int parity;
    private int capacity;

    public RoomHalf() {
    }

    public RoomHalf(Room room, int parity) {
        this.id = room.id() + (parity == 0 ? "/W" : "/B");
        this.room = room;
        this.parity = parity;
        this.capacity = room.capacityOf(parity);
    }

    public String getId() {
        return id;
    }

    public Room getRoom() {
        return room;
    }

    public int getParity() {
        return parity;
    }

    public int getCapacity() {
        return capacity;
    }

    @Override
    public String toString() {
        return id;
    }
}
