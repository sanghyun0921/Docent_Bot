#include "tb3_standalone_nav/costmap/costmap_2d.hpp"

namespace tb3_standalone_nav
{
namespace costmap
{

Costmap2D::Costmap2D(unsigned int cells_size_x, unsigned int cells_size_y, double resolution, double origin_x, double origin_y)
: size_x_(cells_size_x), size_y_(cells_size_y), resolution_(resolution), origin_x_(origin_x), origin_y_(origin_y)
{
  costmap_.resize(size_x_ * size_y_, NO_INFORMATION);
}

unsigned char Costmap2D::getCost(unsigned int mx, unsigned int my) const
{
  if (mx < size_x_ && my < size_y_) {
    return costmap_[my * size_x_ + mx];
  }
  return NO_INFORMATION;
}

void Costmap2D::setCost(unsigned int mx, unsigned int my, unsigned char cost)
{
  if (mx < size_x_ && my < size_y_) {
    costmap_[my * size_x_ + mx] = cost;
  }
}

bool Costmap2D::worldToMap(double wx, double wy, unsigned int & mx, unsigned int & my) const
{
  if (wx < origin_x_ || wy < origin_y_) {
    return false;
  }
  mx = static_cast<unsigned int>((wx - origin_x_) / resolution_);
  my = static_cast<unsigned int>((wy - origin_y_) / resolution_);
  
  if (mx < size_x_ && my < size_y_) {
    return true;
  }
  return false;
}

void Costmap2D::mapToWorld(unsigned int mx, unsigned int my, double & wx, double & wy) const
{
  wx = origin_x_ + (mx + 0.5) * resolution_;
  wy = origin_y_ + (my + 0.5) * resolution_;
}

void Costmap2D::resetMap(unsigned int x0, unsigned int y0, unsigned int xn, unsigned int yn)
{
  std::lock_guard<std::mutex> lock(access_);
  for (unsigned int y = y0; y < yn && y < size_y_; ++y) {
    for (unsigned int x = x0; x < xn && x < size_x_; ++x) {
      costmap_[y * size_x_ + x] = NO_INFORMATION;
    }
  }
}

void Costmap2D::updateInflation(double inscribed_radius, double inflation_radius, double cost_scaling_factor)
{
  std::lock_guard<std::mutex> lock(access_);
  EDT edt(size_x_, size_y_);
  
  // Create binary grid for EDT (0 for obstacles, infinity for free space)
  std::vector<double> binary_grid(size_x_ * size_y_, 1e20);
  for (size_t i = 0; i < costmap_.size(); ++i) {
    if (costmap_[i] == LETHAL_OBSTACLE) {
      binary_grid[i] = 0.0;
    }
  }
  
  // Compute square distances
  std::vector<double> sq_dist_map = edt.compute_edt_2d(binary_grid);
  
  double cell_inscribed_radius = inscribed_radius / resolution_;
  double cell_inflation_radius = inflation_radius / resolution_;
  double sq_cell_inscribed = cell_inscribed_radius * cell_inscribed_radius;
  double sq_cell_inflation = cell_inflation_radius * cell_inflation_radius;
  
  for (size_t i = 0; i < costmap_.size(); ++i) {
    // Skip already lethal obstacles
    if (costmap_[i] == LETHAL_OBSTACLE || sq_dist_map[i] > sq_cell_inflation) {
      continue;
    }
    
    double dist = std::sqrt(sq_dist_map[i]) * resolution_;
    
    if (dist <= inscribed_radius) {
      costmap_[i] = INSCRIBED_INFLATED_OBSTACLE;
    } else {
      // Exponential decay
      double factor = std::exp(-1.0 * cost_scaling_factor * (dist - inscribed_radius));
      unsigned char cost = static_cast<unsigned char>(factor * (INSCRIBED_INFLATED_OBSTACLE - 1));
      
      // Update with max cost strategy
      if (costmap_[i] == NO_INFORMATION || costmap_[i] == FREE_SPACE || cost > costmap_[i]) {
         costmap_[i] = cost;
      }
    }
  }
}

}  // namespace costmap
}  // namespace tb3_standalone_nav
