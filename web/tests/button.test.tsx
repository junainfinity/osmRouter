import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Button } from "@/components/ui/button";

describe("Button", () => {
  it("renders its children", () => {
    render(<Button>Click me</Button>);
    expect(screen.getByText("Click me")).toBeInTheDocument();
  });

  it("calls onClick when clicked", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);
    fireEvent.click(screen.getByText("Go"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("respects disabled state", () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>Nope</Button>);
    fireEvent.click(screen.getByText("Nope"));
    expect(onClick).not.toHaveBeenCalled();
  });
});
